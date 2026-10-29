
import udp from "@SignalRGB/udp";
import { encode } from "@SignalRGB/base64";

// Govee Custom v1.0.3
// SignalRGB LAN plugin
// H61C3 DreamView streaming configuration

const MANUAL_IPS = ["192.168.1.213"];

const PORT_CMD = 4003;
const PORT_SCAN = 4001;
const PORT_LISTEN = 4002;

const MCAST_ADDR = "239.255.255.250";
const BCAST_ADDR = "255.255.255.255";

const PROTO_DREAMVIEW = 1;
const PROTO_RAZER = 2;
const PROTO_SOLID = 3;

const H61C3_ZONES = 15;

// Increase this if streaming causes excessive
// command interruptions.
const REARM_INTERVAL_MS = 120000;

// 33 milliseconds = approximately 30 FPS.
const MIN_FRAME_MS = 100;

const GRADIENT_OFF_SKUS = [
    "H610A", "H6056", "H6047",
    "H610B", "H6046", "H6608",
    "H6609", "H606A", "H6065",
    "H6066", "H6067", "H6061",
    "H6043", "H6042", "H70BC",
    "H6063", "H6069", "H8069"
];

const SKU_PROFILES = {
    "H610A": {
        protocol: PROTO_DREAMVIEW,
        leds: 6,
        label: "Glide Lively Bars"
    },
    "H6062": {
        protocol: PROTO_DREAMVIEW,
        leds: 7,
        label: "Glide Wall Light"
    },
    "H6061": {
        protocol: PROTO_DREAMVIEW,
        leds: 10,
        label: "Hexa Panels"
    },
    "H6143": {
        protocol: PROTO_DREAMVIEW,
        leds: 15,
        label: "RGBIC Strip"
    },
    "H6076": {
        protocol: PROTO_DREAMVIEW,
        leds: 10,
        label: "Floor Lamp Basic"
    },
    "H61C3": {
        protocol: PROTO_DREAMVIEW,
        leds: H61C3_ZONES,
        label: "Neon Rope Gaming"
    }
};

const DEFAULT_PROFILE = {
    protocol: PROTO_DREAMVIEW,
    leds: 10,
    label: "Govee Device"
};

function profileForSku(sku) {
    if (!sku) return DEFAULT_PROFILE;

    if (SKU_PROFILES[sku]) {
        return SKU_PROFILES[sku];
    }

    for (const key of Object.keys(SKU_PROFILES)) {
        if (sku.indexOf(key) === 0) {
            return SKU_PROFILES[key];
        }
    }

    return DEFAULT_PROFILE;
}

function gradientOffFor(sku) {
    if (!sku) return 1;

    for (const s of GRADIENT_OFF_SKUS) {
        if (sku.indexOf(s) === 0) {
            return 0;
        }
    }

    return 1;
}

// -----------------------------------------
// SignalRGB plugin information
// -----------------------------------------

export function Name() {
    return "Govee Custom";
}

export function Version() {
    return "1.0.3";
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

// -----------------------------------------
// User controls
// -----------------------------------------

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
            min: "0",
            max: "360",
            type: "color",
            default: "#ff0000"
        },
        {
            property: "onShutdown",
            group: "settings",
            label: "On shutdown",
            type: "combobox",
            values: [
                "Turn device off",
                "Release control"
            ],
            default: "Release control"
        }
    ];
}

// -----------------------------------------
// Device state
// -----------------------------------------

let dev = {
    ip: null,
    sku: null,
    protocol: PROTO_DREAMVIEW,
    ledCount: H61C3_ZONES,
    gradientOff: 1,

    sock: null,
    ledPositions: [],

    lastFrame: 0,
    lastArm: 0,
    lastDebug: 0,
    lastSolid: "",

    firstRenderLogged: false,
    razerArmed: false,
    sentCount: 0
};

// -----------------------------------------
// Device initialization
// -----------------------------------------

export function Initialize() {
    dev.ip = controller.ip;
    dev.sku = controller.sku;

    const profile = profileForSku(dev.sku);

    // IMPORTANT:
    // Use the current profile instead of the
    // potentially outdated cached protocol.
    dev.protocol = profile.protocol;

    dev.ledCount = profile.leds;

    // Explicitly restore DreamView on H61C3.
    // This ignores a cached Solid Color setting.
    if (dev.sku && dev.sku.indexOf("H61C3") === 0) {
        dev.protocol = PROTO_RAZER;
        dev.ledCount = H61C3_ZONES;
    }

    dev.gradientOff = gradientOffFor(dev.sku);

    dev.lastFrame = 0;
    dev.lastArm = 0;
    dev.lastDebug = 0;
    dev.lastSolid = "";
    dev.sentCount = 0;
    dev.razerArmed = false;
    dev.firstRenderLogged = false;

    device.setName(
        controller.name ||
        ("Govee " + (dev.sku || "Device"))
    );

    buildLayout(dev.ledCount);

    dev.sock = udp.createSocket();

    dev.sock.on("error", (err, msg) => {
        device.log(
            "[GoveeCustom] Socket error: " + msg
        );
    });

    const lastOctet =
        parseInt(
            String(dev.ip).split(".").pop(),
            10
        ) || 0;

    const bindPort = 46920 + (lastOctet % 500);

    try {
        dev.sock.bind(bindPort);

        device.log(
            "[GoveeCustom] Socket bound: " +
            bindPort
        );
    } catch (e) {
        try {
            dev.sock.bind(0);

            device.log(
                "[GoveeCustom] Ephemeral socket bound"
            );
        } catch (e2) {
            device.log(
                "[GoveeCustom] Socket bind failed: " +
                e2.message
            );
        }
    }

    device.log(
        "[GoveeCustom] Initialized " +
        dev.sku +
        " IP=" + dev.ip +
        " protocol=" + dev.protocol +
        " zones=" + dev.ledCount
    );

    armDevice(Date.now());
}

function buildLayout(count) {
    dev.ledPositions = [];

    for (let i = 0; i < count; i++) {
        dev.ledPositions.push([i, 0]);
    }
}

// -----------------------------------------
// Lighting renderer
// -----------------------------------------

export function Render() {
    const now = Date.now();

    if (now - dev.lastFrame < MIN_FRAME_MS) {
        return;
    }

    dev.lastFrame = now;

    if (!dev.firstRenderLogged) {
        dev.firstRenderLogged = true;

        device.log(
            "[GoveeCustom] First render " +
            dev.sku +
            " protocol=" + dev.protocol
        );
    }

    // Re-enter streaming mode periodically,
    // not on every frame.
    if (
        now - dev.lastArm > REARM_INTERVAL_MS
    ) {
        armDevice(now);
    }

    const colors = [];

    for (let i = 0; i < dev.ledCount; i++) {
        const position = dev.ledPositions[i];

        let color;

        if (lightingMode === "Forced") {
            color = toRgb(forcedColor);
        } else {
            color = device.color(
                position[0],
                position[1]
            );
        }

        colors.push(color);
    }

    let sent = false;

    if (dev.protocol === PROTO_SOLID) {
        sent = sendSolid(colors[0]);
    } else {
        sent = sendStream(colors);
    }

    dev.sentCount++;

    if (now - dev.lastDebug > 3000) {
        dev.lastDebug = now;

        const first = colors[0] || [0, 0, 0];

        device.log(
            "[GoveeCustom] " +
            dev.sku +
            " mode=" + lightingMode +
            " protocol=" + dev.protocol +
            " zone0=" + first.join(",") +
            " frames=" + dev.sentCount +
            " armed=" + dev.razerArmed +
            " lastSend=" + sent
        );
    }
}

// -----------------------------------------
// Streaming mode
// -----------------------------------------

function armDevice(now) {
    dev.lastArm = now;

    // Ensure light is powered on.
    sendCmd({
        msg: {
            cmd: "turn",
            data: {
                value: 1
            }
        }
    });

    if (dev.protocol !== PROTO_SOLID) {
        sendCmd(razerModeCommand(true));
        dev.razerArmed = true;
    } else {
        dev.razerArmed = false;
    }
}

function razerModeCommand(enable) {
    const en = enable ? 1 : 0;

    const packet = [
        0xBB,
        0x00,
        0x01,
        0xB1,
        en,
        en ? 0x0A : 0x0B
    ];

    return {
        msg: {
            cmd: "razer",
            data: {
                pt: encode(packet)
            }
        }
    };
}

// -----------------------------------------
// RGBIC DreamView frames
// -----------------------------------------

function sendStream(colors) {
    let collection = [
        dev.gradientOff,
        colors.length
    ];

    for (const color of colors) {
        collection.push(
            color[0],
            color[1],
            color[2]
        );
    }

    let packet;

    if (dev.protocol === PROTO_RAZER) {
    const dataLength = 2 + (colors.length * 3);

    packet = [
        0xBB,
        (dataLength >> 8) & 0xFF,
        dataLength & 0xFF,
        0xB0,
        0x01,
        colors.length
    ];

        for (const color of colors) {
            packet.push(
                color[0],
                color[1],
                color[2]
            );
        }
    } else {
       const length = collection.length;

        packet = [
            0xBB,
            (length >> 8) & 0xFF,
            length & 0xFF,
            0xB0
        ].concat(collection);
    }

    packet.push(xor(packet));

    return sendCmd({
        msg: {
            cmd: "razer",
            data: {
                pt: encode(packet)
            }
        }
    });
}

// -----------------------------------------
// Solid color fallback
// -----------------------------------------

function sendSolid(color) {
    if (!color) return false;

    const key = color.join(",");

    if (key === dev.lastSolid) {
        return true;
    }

    const ok = sendCmd({
        msg: {
            cmd: "colorwc",
            data: {
                color: {
                    r: color[0],
                    g: color[1],
                    b: color[2]
                },
                colorTemInKelvin: 0
            }
        }
    });

    if (ok) {
        dev.lastSolid = key;
    }

    return ok;
}

// -----------------------------------------
// Network sending
// -----------------------------------------

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
            "[GoveeCustom] Send failed: " +
            e.message
        );

        return false;
    }
}

function xor(bytes) {
    let checksum = 0;

    for (const byte of bytes) {
        checksum ^= byte;
    }

    return checksum;
}

// -----------------------------------------
// Color conversion
// -----------------------------------------

function hexToRgb(hex) {
    const clean = String(hex).replace("#", "");

    return [
        parseInt(clean.substring(0, 2), 16) || 0,
        parseInt(clean.substring(2, 4), 16) || 0,
        parseInt(clean.substring(4, 6), 16) || 0
    ];
}

function toRgb(value) {
    if (Array.isArray(value)) {
        return [
            value[0] | 0,
            value[1] | 0,
            value[2] | 0
        ];
    }

    if (typeof value === "string") {
        const s = value.trim();

        if (s.startsWith("#")) {
            return hexToRgb(s);
        }

        const match = s.match(
            /(\d+)\D+(\d+)\D+(\d+)/
        );

        if (match) {
            return [
                parseInt(match[1], 10),
                parseInt(match[2], 10),
                parseInt(match[3], 10)
            ];
        }
    }

    return [0, 0, 0];
}

// -----------------------------------------
// Shutdown
// -----------------------------------------

export function Shutdown(SystemSuspending) {
    try {
        if (dev.protocol !== PROTO_SOLID) {
            sendCmd(razerModeCommand(false));
        }

        if (onShutdown === "Turn device off") {
            for (let i = 0; i < 3; i++) {
                sendCmd({
                    msg: {
                        cmd: "turn",
                        data: {
                            value: 0
                        }
                    }
                });
            }
        }
    } catch (e) {
        // Best effort cleanup.
    }
}

// -----------------------------------------
// Discovery service
// -----------------------------------------

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
        if (this.sock) return;

        this.sock = udp.createSocket();

        this.sock.on(
            "message",
            this.onMessage.bind(this)
        );

        this.sock.on("error", (err, msg) => {
            service.log(
                "[GoveeCustom] Discovery socket error: " +
                msg
            );
        });

        service.log(
            "[GoveeCustom] Binding UDP " +
            PORT_LISTEN
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
                    "[GoveeCustom] Scan failed for " +
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
            protocol: profile.protocol,
            ledCount: profile.leds,
            name:
                "Govee " +
                (data.sku || "Device") +
                " (" + profile.label + ")"
        };

        if (!this.controllers[ip]) {
            this.controllers[ip] = ctrl;

            service.log(
                "[GoveeCustom] Discovered " +
                ctrl.name + " @ " + ip
            );

            service.addController(ctrl);
            service.announceController(ctrl);
            this.saveCache();
        } else {
            // Refresh the existing controller profile.
            // Do not retain an old Solid protocol.
            const existing = this.controllers[ip];

            existing.id = ctrl.id;
            existing.ip = ctrl.ip;
            existing.sku = ctrl.sku;
            existing.protocol = ctrl.protocol;
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
        if (!address) return null;

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
            // Ignore cache errors.
        }
    };

    this.loadCache = function () {
        try {
            const raw = service.getSetting(
                "goveeCustom",
                "cache"
            );

            if (!raw) return;

            const cached = JSON.parse(raw);

            for (const ip of Object.keys(cached)) {
                const ctrl = cached[ip];

                // Update old cached configurations.
                const profile =
                    profileForSku(ctrl.sku);

                ctrl.protocol = profile.protocol;
                ctrl.ledCount = profile.leds;

                if (
                    ctrl.sku &&
                    ctrl.sku.indexOf("H61C3") === 0
                ) {
                    ctrl.protocol = PROTO_DREAMVIEW;
                    ctrl.ledCount = H61C3_ZONES;
                }

                this.controllers[ip] = ctrl;

                service.addController(ctrl);
                service.announceController(ctrl);

                service.log(
                    "[GoveeCustom] Restored cached " +
                    (ctrl.name || ip) +
                    " protocol=" +
                    ctrl.protocol
                );
            }
        } catch (e) {
            service.log(
                "[GoveeCustom] Cache loading error"
            );
        }
    };
}
