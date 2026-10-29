
import udp from "@SignalRGB/udp";

// ==========================================
// Govee H61C3 Custom - Version 1.1.0
// SignalRGB LAN Plugin
//
// Static is the default for stability.
// Dreamview streaming is experimental.
// No automatic streaming re-arm.
// No periodic status polling.
// ==========================================

const SKU = "H61C3";
const LEDS = 42;

const CMD_PORT = 4003;
const SCAN_PORT = 4001;
const LISTEN_PORT = 4002;

const STREAM_MS = 50;
const STATIC_MS = 120;
const STATIC_REFRESH_MS = 2000;
const STREAM_SETTLE_MS = 250;

const PROFILE = {
    name: "RGBIC LED Neon Rope Lights for Desks",
    sku: SKU,
    ledCount: LEDS,
    supportDreamView: true,
    supportRazer: true,
    deviceImage:
        "https://assets.signalrgb.com/devices/brands/govee/wifi/h61c2.png"
};

// ==========================================
// Plugin information
// ==========================================

export function Name() {
    return "Govee H61C3 Custom";
}

export function Version() {
    return "1.1.0";
}

export function Type() {
    return "network";
}

export function Publisher() {
    return "Custom";
}

export function Size() {
    return [42, 1];
}

export function SubdeviceController() {
    return true;
}

// ==========================================
// User controls
// ==========================================

export function ControllableParameters() {
    return [
        {
            property: "LightingMode",
            group: "lighting",
            label: "Lighting Mode",
            type: "combobox",
            values: ["Canvas", "Forced"],
            default: "Canvas"
        },
        {
            property: "forcedColor",
            group: "lighting",
            label: "Forced Color",
            type: "color",
            min: "0",
            max: "360",
            default: "#ff0000"
        },
        {
            property: "protocolSelect",
            group: "settings",
            label: "Protocol",
            type: "combobox",
            values: [
                "Static",
                "Dreamview",
                "Auto"
            ],
            default: "Static"
        },
        {
            property: "blendSegments",
            group: "settings",
            label: "Dreamview Blending",
            type: "combobox",
            values: ["Off", "On"],
            default: "Off"
        },
        {
            property: "shutdownColor",
            group: "lighting",
            label: "Shutdown Color",
            type: "color",
            min: "0",
            max: "360",
            default: "#000000"
        },
        {
            property: "TurnOffOnShutdown",
            group: "settings",
            label: "Turn off on unlink",
            type: "boolean",
            default: false
        }
    ];
}

// ==========================================
// Runtime state
// ==========================================

let socket;
let connected = false;
let activeMode = null;
let readyAt = 0;
let lastFrame = 0;
let lastStatic = 0;
let lastStaticColor = "";
let firstFrameLogged = false;
let channelReady = false;

function log(message) {
    device.log("[H61C3 v1.1.0] " + message);
}

// ==========================================
// Network commands
// ==========================================

function send(command) {
    if (!socket || !connected) {
        return false;
    }

    try {
        socket.send(
            JSON.stringify({
                msg: command
            })
        );
        return true;
    } catch (e) {
        log("Send error: " + e.message);
        return false;
    }
}

function power(on) {
    return send({
        cmd: "turn",
        data: {
            value: on ? 1 : 0
        }
    });
}

function streaming(enable) {
    return send({
        cmd: "razer",
        data: {
            pt: enable
                ? "uwABsQEK"
                : "uwABsQAL"
        }
    });
}

// ==========================================
// Color utilities
// ==========================================

function clamp(value) {
    return Math.max(
        0,
        Math.min(
            255,
            Math.round(Number(value) || 0)
        )
    );
}

function checksum(bytes) {
    let result = 0;

    for (const byte of bytes) {
        result ^= byte;
    }

    return result & 255;
}

function getColors() {
    const channel = device.channel("Channel 1");

    if (LightingMode === "Forced") {
        return device.createColorArray(
            forcedColor,
            LEDS,
            "Inline"
        );
    }

    if (channel.shouldPulseColors()) {
        return device.createColorArray(
            device.getChannelPulseColor(
                "Channel 1"
            ),
            LEDS,
            "Inline"
        );
    }

    return channel.getColors("Inline");
}

function normalizeColors(raw) {
    const output = [];

    for (let i = 0; i < LEDS; i++) {
        const index = i * 3;

        output.push(
            clamp(raw[index]),
            clamp(raw[index + 1]),
            clamp(raw[index + 2])
        );
    }

    return output;
}

// ==========================================
// Stable static output
// ==========================================

function sendStatic(colors, now) {
    const center =
        Math.floor(LEDS / 2) * 3;

    const rgb = [
        colors[center],
        colors[center + 1],
        colors[center + 2]
    ];

    const key = rgb.join(",");

    if (
        now - lastStatic < STATIC_MS
    ) {
        return;
    }

    if (
        key === lastStaticColor &&
        now - lastStatic < STATIC_REFRESH_MS
    ) {
        return;
    }

    const sent = send({
        cmd: "colorwc",
        data: {
            color: {
                r: rgb[0],
                g: rgb[1],
                b: rgb[2]
            },
            colorTemInKelvin: 0
        }
    });

    if (sent) {
        lastStatic = now;
        lastStaticColor = key;
    }
}

// ==========================================
// Experimental Dreamview output
// ==========================================

function sendDreamview(colors) {
    const mode =
        blendSegments === "On" ? 1 : 0;

    const payload = [
        mode,
        LEDS,
        ...colors
    ];

    const packet = [
        0xBB,
        (payload.length >> 8) & 255,
        payload.length & 255,
        0xB0,
        ...payload
    ];

    packet.push(checksum(packet));

    send({
        cmd: "razer",
        data: {
            pt: base64.Encode(packet)
        }
    });
}

function chooseMode() {
    // Auto deliberately uses Static.
    // Only explicit Dreamview enables streaming.
    return protocolSelect === "Dreamview"
        ? "Dreamview"
        : "Static";
}

// ==========================================
// Device initialization
// ==========================================

export function Initialize() {
    if (socket) {
        try {
            socket.disconnect();
        } catch (e) {
            // Already disconnected.
        }

        try {
            socket.close();
        } catch (e) {
            // Already closed.
        }
    }

    socket = undefined;
    connected = false;
    activeMode = null;
    readyAt = 0;
    lastFrame = 0;
    lastStatic = 0;
    lastStaticColor = "";
    firstFrameLogged = false;
    channelReady = false;

    device.addFeature("base64");

    device.setName(
        "Govee H61C3 - Stable / Dreamview"
    );

    device.setImageFromUrl(
        PROFILE.deviceImage
    );

    device.addChannel(
        "Channel 1",
        LEDS
    );

    device.channel(
        "Channel 1"
    ).SetLedLimit(LEDS);

    device.SetLedLimit(LEDS);

    channelReady = true;

    socket = udp.createSocket();

    socket.on(
        "error",
        (code, message) => {
            log(
                "UDP error: " +
                code + " " + message
            );
        }
    );

    socket.on("connection", () => {
        connected = true;

        // One power command on connection.
        // Not repeated during rendering.
        power(true);

        log(
            "Connected to " +
            controller.ip +
            ":" + CMD_PORT
        );
    });

    socket.bind(0);

    socket.connect(
        controller.ip,
        CMD_PORT
    );

    log(
        "Initialized. 42 LEDs. " +
        "Static default. Dreamview optional."
    );
}

// ==========================================
// Main render loop
// ==========================================

export function Render() {
    if (!connected || !channelReady) {
        device.pause(20);
        return;
    }

    const now = Date.now();
    const mode = chooseMode();

    // Change protocol only when selected.
    // No periodic streaming reset.
    if (mode !== activeMode) {
        if (mode === "Static") {
            streaming(false);
        } else {
            streaming(true);
        }

        activeMode = mode;

        lastFrame = 0;
        lastStatic = 0;
        lastStaticColor = "";

        readyAt =
            now + STREAM_SETTLE_MS;

        log("Protocol: " + mode);

        device.pause(20);
        return;
    }

    if (now < readyAt) {
        device.pause(20);
        return;
    }

    const interval =
        mode === "Static"
            ? STATIC_MS
            : STREAM_MS;

    if (
        now - lastFrame < interval
    ) {
        device.pause(10);
        return;
    }

    lastFrame = now;

    const colors = normalizeColors(
        getColors()
    );

    if (mode === "Static") {
        sendStatic(colors, now);
    } else {
        sendDreamview(colors);
    }

    if (!firstFrameLogged) {
        firstFrameLogged = true;

        log(
            "First frame sent: " + mode
        );
    }

    device.pause(
        mode === "Static" ? 30 : 20
    );
}

// ==========================================
// Shutdown
// ==========================================

export function Shutdown(SystemSuspending) {
    if (!connected) {
        return;
    }

    if (activeMode === "Dreamview") {
        streaming(false);
    }

    if (TurnOffOnShutdown) {
        power(false);
        return;
    }

    const color =
        SystemSuspending
            ? "#000000"
            : shutdownColor;

    const rgb = device.createColorArray(
        color,
        1,
        "Inline"
    );

    send({
        cmd: "colorwc",
        data: {
            color: {
                r: clamp(rgb[0]),
                g: clamp(rgb[1]),
                b: clamp(rgb[2])
            },
            colorTemInKelvin: 0
        }
    });
}

// ==========================================
// Discovery service
// ==========================================

export function DiscoveryService() {
    this.IconUrl =
        "https://assets.signalrgb.com/brands/govee/logo.png";

    this.UdpBroadcastPort = SCAN_PORT;
    this.UdpListenPort = LISTEN_PORT;

    this.UdpBroadcastAddress =
        "239.255.255.250";

    this.PollInterval = 30000;
    this.lastPollTime = 0;
    this.firstRun = true;

    this.cache = new DeviceCache();

    this.Initialize = function () {
        service.log(
            "[H61C3 Custom] Searching for H61C3"
        );
    };

    this.CheckForDevices = function () {
        if (
            Date.now() - this.lastPollTime <
            this.PollInterval
        ) {
            return;
        }

        this.lastPollTime = Date.now();

        service.broadcast(
            JSON.stringify({
                msg: {
                    cmd: "scan",
                    data: {
                        account_topic: "reserve"
                    }
                }
            })
        );
    };

    this.Discovered = function (value) {
        let packet;

        try {
            packet = JSON.parse(value.response);
        } catch (e) {
            return;
        }

        if (
            !packet ||
            !packet.msg ||
            packet.msg.cmd !== "scan"
        ) {
            return;
        }

        const data = packet.msg.data;

        // Ignore our own scan request packets.
        if (
            !data ||
            !data.ip ||
            data.sku !== SKU ||
            !data.device
        ) {
            return;
        }

        const id =
            value.id || data.device;

        const old =
            service.getController(id);

        if (old) {
            old.updateWithValue({
                id,
                ...data
            });
        } else {
            const deviceController =
                new H61C3Controller({
                    id,
                    ...data
                });

            service.addController(
                deviceController
            );

            service.announceController(
                deviceController
            );
        }
    };

    this.Update = function () {
        if (this.firstRun) {
            this.firstRun = false;

            for (
                const [id, entry]
                of this.cache.Entries()
            ) {
                if (
                    entry.sku !== SKU ||
                    entry.paired === false
                ) {
                    continue;
                }

                if (!service.getController(id)) {
                    const saved =
                        new H61C3Controller(
                            entry
                        );

                    service.addController(saved);
                    service.announceController(saved);
                }
            }
        }

        for (
            const entry of service.controllers
        ) {
            if (
                entry.obj &&
                typeof entry.obj.update === "function"
            ) {
                entry.obj.update();
            }
        }

        this.CheckForDevices();
    };

    this.link = function (value) {
        const ctrl =
            service.getController(value.id);

        if (!ctrl) {
            return;
        }

        ctrl.paired = true;

        service.announceController(ctrl);

        this.cache.Add(
            ctrl.id,
            ctrl.toCache()
        );
    };

    this.unlink = function (value) {
        const ctrl =
            service.getController(value.id);

        if (!ctrl) {
            return;
        }

        ctrl.paired = false;

        this.cache.Add(
            ctrl.id,
            ctrl.toCache()
        );

        service.suppressController(ctrl);
    };

    this.remove = function (value = false) {
        if (value) {
            const ctrl =
                service.getController(value.id);

            if (ctrl) {
                service.suppressController(ctrl);
                service.removeController(ctrl);
            }

            this.cache.Remove(value.id);
        } else {
            for (
                const [id, entry]
                of this.cache.Entries()
            ) {
                const ctrl =
                    service.getController(id);

                if (ctrl) {
                    service.suppressController(ctrl);
                    service.removeController(ctrl);
                }
            }

            this.cache.Clear();
        }
    };

    this.Shutdown = function () {};
}

// ==========================================
// H61C3 controller
// ==========================================

class H61C3Controller {
    constructor(data) {
        this.id =
            data.id || data.device;

        this.ip = data.ip;
        this.sku = SKU;
        this.name = SKU;

        this.device =
            data.device || this.id;

        this.GoveeInfo = PROFILE;

        this.supportDreamView = true;
        this.supportRazer = true;

        this.deviceImage =
            PROFILE.deviceImage;

        this.paired =
            data.paired !== false;

        this.initialized = false;
    }

    updateWithValue(data) {
        if (data.ip) {
            this.ip = data.ip;
        }

        if (data.device) {
            this.device = data.device;
        }

        service.updateController(this);

        discovery.cache.Add(
            this.id,
            this.toCache()
        );
    }

    update() {
        if (!this.initialized) {
            this.initialized = true;

            service.updateController(this);

            if (this.paired) {
                service.announceController(this);
            }

            discovery.cache.Add(
                this.id,
                this.toCache()
            );
        }
    }

    toCache() {
        return {
            id: this.id,
            ip: this.ip,
            sku: this.sku,
            device: this.device,
            paired: this.paired,
            deviceImage: this.deviceImage,
            supportDreamView: true,
            supportRazer: true
        };
    }
}

// ==========================================
// Persistent device cache
// ==========================================

class DeviceCache {
    constructor() {
        this.map = new Map();

        try {
            const stored =
                service.getSetting(
                    "goveeH61C3",
                    "devices"
                );

            if (stored) {
                this.map = new Map(
                    JSON.parse(stored)
                );
            }

            // Import cached devices from
            // previous stock Govee addon.
            const prior =
                service.getSetting(
                    "ipCache",
                    "cache"
                );

            if (prior) {
                const entries =
                    JSON.parse(prior);

                for (
                    const [id, value]
                    of entries
                ) {
                    if (
                        value &&
                        value.sku === SKU &&
                        value.ip &&
                        !this.map.has(id)
                    ) {
                        this.map.set(id, {
                            ...value,
                            id
                        });
                    }
                }
            }
        } catch (e) {
            this.map = new Map();
        }
    }

    Entries() {
        return this.map.entries();
    }

    Persist() {
        service.saveSetting(
            "goveeH61C3",
            "devices",
            JSON.stringify(
                [...this.map.entries()]
            )
        );
    }

    Add(id, item) {
        this.map.set(id, item);
        this.Persist();
    }

    Remove(id) {
        this.map.delete(id);
        this.Persist();
    }

    Clear() {
        this.map.clear();
        this.Persist();
    }
}
