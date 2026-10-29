
import udp from "@SignalRGB/udp";
import { encode } from "@SignalRGB/base64";

// ==========================================
// Govee Custom v1.1.0
// H61C3 SignalRGB synchronization
//
// Streaming: experimental real-time RGBIC
// Solid: reliable single-color fallback
// ==========================================

const MANUAL_IPS = ["192.168.1.213"];

const PORT_CMD = 4003;
const PORT_SCAN = 4001;
const PORT_LISTEN = 4002;

const MCAST_ADDR = "239.255.255.250";
const BCAST_ADDR = "255.255.255.255";

const H61C3_ZONES = 15;

// Target approximately 25 FPS.
const STREAM_FRAME_MS = 40;

// Solid-color commands are slower.
const SOLID_FRAME_MS = 100;
const SOLID_REFRESH_MS = 1000;

// Refresh streaming ownership without
// sending a power-on command.
const STREAM_KEEPALIVE_MS = 30000;

const PROTOCOL_STREAM = "Streaming (experimental)";
const PROTOCOL_SOLID = "Solid (stable)";

const SKU_PROFILES = {
    "H61C3": {
        leds: H61C3_ZONES,
        label: "Neon Rope Gaming"
    },
    "H610A": {
        leds: 6,
        label: "Glide Lively Bars"
    },
    "H6062": {
        leds: 7,
        label: "Glide Wall Light"
    },
    "H6061": {
        leds: 10,
        label: "Hexa Panels"
    },
    "H6143": {
        leds: 15,
        label: "RGBIC Strip"
    },
    "H6076": {
        leds: 10,
        label: "Floor Lamp"
    }
};

function profileForSku(sku) {
    if (!sku) {
        return { leds: 10, label: "Govee Device" };
    }

    for (const key of Object.keys(SKU_PROFILES)) {
        if (sku.indexOf(key) === 0) {
            return SKU_PROFILES[key];
        }
    }

    return { leds: 10, label: "Govee Device" };
}

// ==========================================
// Plugin information
// ==========================================

export function Name() {
    return "Govee Custom";
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
    return [H61C3_ZONES, 1];
}

export function LedNames() {
    const names = [];

    for (let i = 0; i < H61C3_ZONES; i++) {
        names.push("Zone " + (i + 1));
    }

    return names;
}

export function LedPositions() {
    const positions = [];

    for (let i = 0; i < H61C3_ZONES; i++) {
        positions.push([i, 0]);
    }

    return positions;
}

export function DefaultPosition() {
    return [0, 70];
}

export function DefaultScale() {
    return 1.0;
}

export function SubdeviceController() {
    return false;
}

// ==========================================
// SignalRGB device controls
// ==========================================

export function ControllableParameters() {
    return [
        {
            property: "lightingMode",
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
            property: "protocolMode",
            group: "settings",
            label: "Protocol",
            type: "combobox",
            values: [
                "Streaming (experimental)",
                "Solid (stable)"
            ],
            default: "Solid (stable)"
        },
       
{
    property: "protocolMode",
    group: "settings",
    label: "Protocol",
    type: "combobox",
    values: [
        "Streaming (experimental)",
        "Solid (stable)"
    ],
    default: "Solid (stable)"
},

        {
            property: "onShutdown",
            group: "settings",
            label: "On shutdown",
            type: "combobox",
            values: [
                "Release control",
                "Turn device off"
            ],
            default: "Release control"
        }
    ];
}

// ==========================================
// Runtime state
// ==========================================

let dev = {
    ip: null,
    sku: null,
    ledCount: H61C3_ZONES,
    sock: null,
    ledPositions: [],

    lastFrame: 0,
    lastKeepalive: 0,
    lastDebug: 0,
    lastSolidSent: 0,

    lastSolid: "",
    activeProtocol: null,
    initialized: false,
    sentFrames: 0
};

// ==========================================
// Initialize device
// ==========================================

export function Initialize() {
    dev.ip = controller.ip;
    dev.sku = controller.sku;

    const profile = profileForSku(dev.sku);

    dev.ledCount = profile.leds;

    if (
        dev.sku &&
        dev.sku.indexOf("H61C3") === 0
    ) {
        dev.ledCount = H61C3_ZONES;
    }

    dev.lastFrame = 0;
    dev.lastKeepalive = 0;
    dev.lastDebug = 0;
    dev.lastSolidSent = 0;
    dev.lastSolid = "";
    dev.activeProtocol = null;
    dev.initialized = false;
    dev.sentFrames = 0;

    device.setName(
        controller.name ||
        ("Govee " + (dev.sku || "Device"))
    );

    dev.ledPositions = [];

    for (let i = 0; i < dev.ledCount; i++) {
        dev.ledPositions.push([i, 0]);
    }

    dev.sock = udp.createSocket();

    dev.sock.on("error", (err, msg) => {
        device.log(
            "[GoveeCustom] UDP error: " + msg
        );
    });

    const lastOctet =
        parseInt(
            String(dev.ip).split(".").pop(),
            10
        ) || 0;

    const bindPort =
        46920 + (lastOctet % 500);

    try {
        dev.sock.bind(bindPort);
    } catch (e) {
        try {
            dev.sock.bind(0);
        } catch (e2) {
            device.log(
                "[GoveeCustom] Bind failed: " +
                e2.message
            );
        }
    }

    // Power on only during initialization.
    sendCmd({
        msg: {
            cmd: "turn",
            data: { value: 1 }
        }
    });

    dev.initialized = true;

    device.log(
        "[GoveeCustom] v1.1.0 initialized " +
        dev.sku +
        " IP=" + dev.ip +
        " zones=" + dev.ledCount
    );
}

// ==========================================
// SignalRGB renderer
// ==========================================

export function Render() {
    if (!dev.initialized) {
        return;
    }

    const now = Date.now();

   const mode =
    protocolMode === PROTOCOL_STREAM
        ? PROTOCOL_STREAM
        : PROTOCOL_SOLID;

    // Switch protocol only when requested.
    if (mode !== dev.activeProtocol) {
        switchProtocol(mode, now);
    }

    const frameInterval =
        mode === PROTOCOL_SOLID
            ? SOLID_FRAME_MS
            : STREAM_FRAME_MS;

    if (
        now - dev.lastFrame < frameInterval
    ) {
        return;
    }

    dev.lastFrame = now;

    const colors = [];

    for (let i = 0; i < dev.ledCount; i++) {
        let color;

        if (lightingMode === "Forced") {
            color = toRgb(forcedColor);
        } else {
            const pos = dev.ledPositions[i];

            color = device.color(
                pos[0],
                pos[1]
            );
        }

        colors.push(normalizeColor(color));
    }

    let sent = false;

    if (mode === PROTOCOL_STREAM) {

        // Keep streaming mode alive without
        // repeatedly sending a power command.
        if (
            now - dev.lastKeepalive >=
            STREAM_KEEPALIVE_MS
        ) {
            enableStreaming();
            dev.lastKeepalive = now;
        }

        sent = sendStream(colors);

    } else {

        // Use the center canvas zone for
        // responsive single-color output.
        const center =
            Math.floor(colors.length / 2);

        sent = sendSolid(
            colors[center] || [0, 0, 0],
            now
        );
    }

    dev.sentFrames++;

    if (now - dev.lastDebug >= 5000) {
        dev.lastDebug = now;

        device.log(
            "[GoveeCustom] mode=" +
            mode +
            " lighting=" + lightingMode +
            " frames=" + dev.sentFrames +
            " lastSend=" + sent
        );
    }
}

// ==========================================
// Protocol switching
// ==========================================


function switchProtocol(mode, now) {
    dev.activeProtocol = mode;
    dev.lastFrame = 0;
    dev.lastSolid = "";
    dev.lastSolidSent = 0;

    if (mode === PROTOCOL_STREAM) {
        enableStreaming();
        dev.lastKeepalive = now;
    } else {
        // Explicitly exit streaming mode.
        disableStreaming();
    }

    device.log(
        "[GoveeCustom] Protocol: " + mode
    );
}


// ==========================================
// Streaming mode commands
// ==========================================

function streamingControl(enable) {
    const flag = enable ? 1 : 0;

    const packet = [
        0xBB,
        0x00,
        0x01,
        0xB1,
        flag
    ];

    packet.push(xor(packet));

    return sendEncoded(packet);
}

function enableStreaming() {
    return streamingControl(true);
}

function disableStreaming() {
    return streamingControl(false);
}

// ==========================================
// RGBIC streaming frames
//
// BB 00 LEN B0 GRADIENT COUNT RGB... XOR
//
// LEN = 2 + 3 * COUNT
// ==========================================

function sendStream(colors) {
    if (!colors || colors.length === 0) {
        return false;
    }

    const count = Math.min(
        colors.length,
        80
    );

    const length = 2 + count * 3;

    const gradient =
        gradientMode === "Discrete" ? 0 : 1;

    const packet = [
        0xBB,
        (length >> 8) & 0xFF,
        length & 0xFF,
        0xB0,
        gradient,
        count
    ];

    for (let i = 0; i < count; i++) {
        const color =
            normalizeColor(colors[i]);

        packet.push(
            color[0],
            color[1],
            color[2]
        );
    }

    packet.push(xor(packet));

    return sendEncoded(packet);
}

function sendEncoded(packet) {
    return sendCmd({
        msg: {
            cmd: "razer",
            data: {
                pt: encode(packet)
            }
        }
    });
}

// ==========================================
// Stable solid-color fallback
// ==========================================

function sendSolid(color, now) {
    const rgb = normalizeColor(color);

    const key = rgb.join(",");

    // Only send a repeated color as a
    // periodic refresh.
    if (
        key === dev.lastSolid &&
        now - dev.lastSolidSent <
        SOLID_REFRESH_MS
    ) {
        return true;
    }

    const ok = sendCmd({
        msg: {
            cmd: "colorwc",
            data: {
                color: {
                    r: rgb[0],
                    g: rgb[1],
                    b: rgb[2]
                },
                colorTemInKelvin: 0
            }
        }
    });

    if (ok) {
        dev.lastSolid = key;
        dev.lastSolidSent = now;
    }

    return ok;
}

// ==========================================
// Utilities
// ==========================================

function normalizeColor(color) {
    if (!color) {
        return [0, 0, 0];
    }

    return [
        clampByte(color[0]),
        clampByte(color[1]),
        clampByte(color[2])
    ];
}

function clampByte(value) {
    const number = Number(value) || 0;

    return Math.max(
        0,
        Math.min(255, Math.round(number))
    );
}

function toRgb(value) {
    if (Array.isArray(value)) {
        return normalizeColor(value);
    }

    if (typeof value === "string") {
        const s = value.trim();

        if (s.startsWith("#")) {
            const hex = s.substring(1);

            if (hex.length === 6) {
                return [
                    parseInt(hex.substring(0, 2), 16),
                    parseInt(hex.substring(2, 4), 16),
                    parseInt(hex.substring(4, 6), 16)
                ].map(clampByte);
            }
        }

        const match = s.match(
            /(\d+)\D+(\d+)\D+(\d+)/
        );

        if (match) {
            return [
                clampByte(match[1]),
                clampByte(match[2]),
                clampByte(match[3])
            ];
        }
    }

    return [0, 0, 0];
}

function xor(bytes) {
    let checksum = 0;

    for (const byte of bytes) {
        checksum ^= byte;
    }

    return checksum & 0xFF;
}

function sendCmd(command) {
    if (!dev.sock || !dev.ip) {
        return false;
    }

    try {
        dev.sock.write(
            command,
            dev.ip,
            PORT_CMD
        );

        return true;
    } catch (e) {
        device.log(
            "[GoveeCustom] Send error: " +
            e.message
        );

        return false;
    }
}

// ==========================================
// Shutdown
// ==========================================

export function Shutdown(SystemSuspending) {
    try {
        if (
            dev.activeProtocol ===
            PROTOCOL_STREAM
        ) {
            disableStreaming();
        }

        if (onShutdown === "Turn device off") {
            sendCmd({
                msg: {
                    cmd: "turn",
                    data: { value: 0 }
                }
            });
        }
    } catch (e) {
        // Best-effort shutdown.
    }
}

// ==========================================
// Govee LAN discovery service
// ==========================================

export function DiscoveryService() {
    this.IconUrl = null;

    this.lastPollTime = -10000;
    this.PollInterval = 5000;
    this.controllers = {};

    this.Initialize = function () {
        service.log(
            "[GoveeCustom] Discovery v" +
            Version()
        );

        this.startSocket();
        this.loadCache();
        this.sendScan();
    };

    this.startSocket = function () {
        if (this.sock) {
            return;
        }

        this.sock = udp.createSocket();

        this.sock.on(
            "message",
            this.onMessage.bind(this)
        );

        this.sock.on(
            "error",
            (err, msg) => {
                service.log(
                    "[GoveeCustom] Discovery error: " +
                    msg
                );
            }
        );

        this.sock.bind(PORT_LISTEN);
    };

    this.sendScan = function () {
        const request = {
            msg: {
                cmd: "scan",
                data: {
                    account_topic: "reserve"
                }
            }
        };

        const targets = [
            MCAST_ADDR,
            BCAST_ADDR
        ].concat(MANUAL_IPS);

        for (const target of targets) {
            try {
                this.sock.write(
                    request,
                    target,
                    PORT_SCAN
                );
            } catch (e) {
                service.log(
                    "[GoveeCustom] Scan failed: " +
                    target
                );
            }
        }
    };

    this.onMessage = function (value) {
        if (!value || !value.data) {
            return;
        }

        let response;

        try {
            response = JSON.parse(value.data);
        } catch (e) {
            return;
        }

        if (
            !response.msg ||
            response.msg.cmd !== "scan" ||
            !response.msg.data
        ) {
            return;
        }

        const data = response.msg.data;

        const ip =
            data.ip ||
            this.ipOf(value.address);

        if (!ip || !data.device) {
            return;
        }

        const profile =
            profileForSku(data.sku);

        const ctrl = {
            id: data.device,
            ip: ip,
            sku: data.sku || null,
            ledCount: profile.leds,
            name:
                "Govee " +
                (data.sku || "Device") +
                " (" + profile.label + ")"
        };

        if (!this.controllers[ip]) {
            this.controllers[ip] = ctrl;

            service.addController(ctrl);
            service.announceController(ctrl);

            this.saveCache();

            service.log(
                "[GoveeCustom] Discovered " +
                ctrl.name + " @ " + ip
            );
        } else {
            const existing =
                this.controllers[ip];

            existing.id = ctrl.id;
            existing.ip = ctrl.ip;
            existing.sku = ctrl.sku;
            existing.ledCount = ctrl.ledCount;
            existing.name = ctrl.name;

            service.updateController(existing);
        }
    };

    this.Update = function (force) {
        const now = Date.now();

        if (
            force === true ||
            now - this.lastPollTime >
            this.PollInterval
        ) {
            this.lastPollTime = now;
            this.sendScan();
        }
    };

    this.ipOf = function (address) {
        if (!address) {
            return null;
        }

        const match = address.match(
            /(\d{1,3}\.){3}\d{1,3}/
        );

        return match ? match[0] : null;
    };

    this.saveCache = function () {
        try {
            service.saveSetting(
                "goveeCustom",
                "cache",
                JSON.stringify(this.controllers)
            );
        } catch (e) {
            // Cache is optional.
        }
    };

    this.loadCache = function () {
        try {
            const raw = service.getSetting(
                "goveeCustom",
                "cache"
            );

            if (!raw) {
                return;
            }

            const cached = JSON.parse(raw);

            for (const ip of Object.keys(cached)) {
                const ctrl = cached[ip];

                const profile =
                    profileForSku(ctrl.sku);

                ctrl.ledCount = profile.leds;

                this.controllers[ip] = ctrl;

                service.addController(ctrl);
                service.announceController(ctrl);
            }
        } catch (e) {
            service.log(
                "[GoveeCustom] Cache loading error"
            );
        }
    };
}
