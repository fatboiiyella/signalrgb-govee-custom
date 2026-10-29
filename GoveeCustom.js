
import udp from "@SignalRGB/udp";
import { encode } from "@SignalRGB/base64";

// Govee Custom v1.0.2
// Disable the stock Govee addon to avoid UDP port conflicts.

const MANUAL_IPS = ["192.168.1.213"];

const PORT_CMD = 4003;
const PORT_SCAN = 4001;
const PORT_LISTEN = 4002;
const MCAST_ADDR = "239.255.255.250";
const BCAST_ADDR = "255.255.255.255";

const PROTO_DREAMVIEW = 1;
const PROTO_RAZER = 2;
const PROTO_SOLID = 3;

const GRADIENT_OFF_SKUS = [
    "H610A", "H6056", "H6047", "H610B", "H6046",
    "H6608", "H6609", "H606A", "H6065", "H6066",
    "H6067", "H6061", "H6043", "H6042", "H70BC",
    "H6063", "H6069", "H8069"
];

const SKU_PROFILES = {
    "H610A": { protocol: PROTO_DREAMVIEW, leds: 6, label: "Glide Lively Bars" },
    "H6062": { protocol: PROTO_DREAMVIEW, leds: 7, label: "Glide Wall Light" },
    "H6061": { protocol: PROTO_DREAMVIEW, leds: 10, label: "Hexa Panels" },
    "H6143": { protocol: PROTO_DREAMVIEW, leds: 15, label: "RGBIC Strip" },
    "H6076": { protocol: PROTO_DREAMVIEW, leds: 10, label: "Floor Lamp Basic" },
   "H61C3": { protocol: PROTO_DREAMVIEW, leds: 15, label: "Neon Rope (Gaming)" }
};

const DEFAULT_PROFILE = {
    protocol: PROTO_DREAMVIEW,
    leds: 10,
    label: "Govee device"
};

function profileForSku(sku) {
    if (!sku) return DEFAULT_PROFILE;
    if (SKU_PROFILES[sku]) return SKU_PROFILES[sku];

    for (const key of Object.keys(SKU_PROFILES)) {
        if (sku.indexOf(key) === 0) return SKU_PROFILES[key];
    }

    return DEFAULT_PROFILE;
}

function gradientOffFor(sku) {
    if (!sku) return 1;

    for (const s of GRADIENT_OFF_SKUS) {
        if (sku.indexOf(s) === 0) return 0;
    }

    return 1;
}

// SignalRGB device metadata

export function Name() { return "Govee Custom"; }
export function Version() { return "1.0.2"; }
export function Type() { return "network"; }
export function Publisher() { return "Custom"; }
export function Size() { return [15, 1]; }

export function LedNames() {
    return Array.from(
        { length: 15 },
        (_, i) => "Zone " + (i + 1)
    );
}

export function LedPositions() {
    return Array.from(
        { length: 15 },
        (_, i) => [i, 0]
    );
}

export function DefaultPosition() { return [0, 70]; }
export function DefaultScale() { return 1.0; }
export function SubdeviceController() { return false; }

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
            default: "#009bde"
        },
        {
            property: "onShutdown",
            group: "settings",
            label: "On shutdown",
            type: "combobox",
            values: ["Turn device off", "Release control"],
            default: "Turn device off"
        },
        {
            property: "reArmSeconds",
            group: "settings",
            label: "Re-arm interval (s)",
            type: "combobox",
            values: ["2", "4", "8"],
            default: "4"
        }
    ];
}

let dev = {
    ip: null,
    sku: null,
    protocol: PROTO_DREAMVIEW,
    ledCount: 10,
    gradientOff: 1,
    sock: null,
    ledNames: [],
    ledPositions: [],
    lastFrame: 0,
    lastArm: 0,
    lastSolid: "",
    razerArmed: false,
    firstRenderLogged: false,
    lastDebug: 0,
    sentCount: 0
};

const MIN_FRAME_MS = 25;

// Device initialization
// Corrected: no unsupported device.setLedNames methods.

export function Initialize() {
    dev.ip = controller.ip;
    dev.sku = controller.sku;
   dev.protocol = dev.sku === "H61C3"
    ? PROTO_SOLID
    : (controller.protocol || PROTO_DREAMVIEW);
    dev.ledCount = controller.ledCount || 10;
    dev.gradientOff = gradientOffFor(dev.sku);

    device.setName(
        controller.name || ("Govee " + (dev.sku || "device"))
    );

    buildLayout(dev.ledCount);

    dev.sock = udp.createSocket();

    dev.sock.on("error", (err, msg) => {
        device.log("socket error: " + msg);
    });

    const lastOctet =
        parseInt(("" + dev.ip).split(".").pop(), 10) || 0;

    const bindPort = 46920 + (lastOctet % 500);

    try {
        dev.sock.bind(bindPort);
        device.log(
            "[GoveeCustom] send socket bound to " + bindPort
        );
    } catch (e) {
        try {
            dev.sock.bind(0);
            device.log(
                "[GoveeCustom] send socket bound to ephemeral port"
            );
        } catch (e2) {
            device.log(
                "[GoveeCustom] bind failed: " + e2.message
            );
        }
    }

    device.log(
        "Govee Custom init: " +
        dev.sku + " @ " +
        dev.ip + ", " +
        dev.ledCount + " zones, proto " +
        dev.protocol
    );

    armDevice(Date.now(), true);
}

function buildLayout(n) {
    dev.ledNames = [];
    dev.ledPositions = [];

    for (let i = 0; i < n; i++) {
        dev.ledNames.push("Zone " + (i + 1));
        dev.ledPositions.push([i, 0]);
    }
}

// Lighting renderer

export function Render() {
    const now = Date.now();

    if (now - dev.lastFrame < MIN_FRAME_MS) return;
    dev.lastFrame = now;

    if (!dev.firstRenderLogged) {
        dev.firstRenderLogged = true;
        device.log(
            "[GoveeCustom] first Render for " +
            dev.sku + " @ " + dev.ip
        );
    }

    const reArmMs =
        (parseInt(reArmSeconds, 10) || 4) * 1000;

    if (now - dev.lastArm > reArmMs) {
        armDevice(now, false);
    }

    const colors = [];

    for (let i = 0; i < dev.ledCount; i++) {
        const p = dev.ledPositions[i];
        let c;

        if (lightingMode === "Forced") {
            c = toRgb(forcedColor);
        } else {
            c = device.color(p[0], p[1]);
        }

        colors.push(c);
    }

    let ok;

    if (dev.protocol === PROTO_SOLID) {
        ok = sendSolid(colors[0]);
    } else {
        ok = sendStream(colors);
    }

    dev.sentCount++;

    if (now - dev.lastDebug > 3000) {
        dev.lastDebug = now;

        const z = colors[0] || [0, 0, 0];

        device.log(
            "[GoveeCustom] " +
            dev.sku +
            " mode=" + lightingMode +
            " zone0=[" + z.join(",") + "]" +
            " armed=" + dev.razerArmed +
            " frames=" + dev.sentCount +
            " lastSend=" + ok
        );
    }
}

// Device streaming controls

function armDevice(now, force) {
    dev.lastArm = now;

    sendCmd({
        msg: {
            cmd: "turn",
            data: { value: 1 }
        }
    });

    if (dev.protocol !== PROTO_SOLID) {
        sendCmd(razerModeCommand(true));
        dev.razerArmed = true;
    } else if (force) {
        sendCmd(razerModeCommand(false));
        dev.razerArmed = false;
    }
}

function razerModeCommand(enable) {
    const en = enable ? 1 : 0;

    const pt = encode([
        0xBB, 0x00, 0x01, 0xB1,
        en, en ? 0x0A : 0x0B
    ]);

    return {
        msg: {
            cmd: "razer",
            data: { pt: pt }
        }
    };
}

function sendStream(colors) {
    let collection = [
        dev.gradientOff,
        colors.length
    ];

    for (const c of colors) {
        collection = collection.concat([
            c[0], c[1], c[2]
        ]);
    }

    let packet;

    if (dev.protocol === PROTO_RAZER) {
        packet = [
            0xBB, 0x00, 0x0E,
            0xB0, 0x01, colors.length
        ];

        for (const c of colors) {
            packet = packet.concat([
                c[0], c[1], c[2]
            ]);
        }
    } else {
        const len = collection.length;

        packet = [
            0xBB,
            (len >> 8) & 0xFF,
            len & 0xFF,
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

function sendSolid(c) {
    const key = c.join(",");

    if (key === dev.lastSolid) return true;

    dev.lastSolid = key;

    return sendCmd({
        msg: {
            cmd: "colorwc",
            data: {
                color: {
                    r: c[0],
                    g: c[1],
                    b: c[2]
                },
                colorTemInKelvin: 0
            }
        }
    });
}

function xor(bytes) {
    let cs = 0;

    for (const b of bytes) {
        cs ^= b;
    }

    return cs;
}

function sendCmd(obj) {
    if (!dev.sock || !dev.ip) return false;

    try {
        dev.sock.write(obj, dev.ip, PORT_CMD);
        return true;
    } catch (e) {
        device.log(
            "[GoveeCustom] send failed: " + e.message
        );
        return false;
    }
}

function hexToRgb(hex) {
    hex = ("" + hex).replace("#", "");

    return [
        parseInt(hex.substring(0, 2), 16) || 0,
        parseInt(hex.substring(2, 4), 16) || 0,
        parseInt(hex.substring(4, 6), 16) || 0
    ];
}

function toRgb(v) {
    if (Array.isArray(v)) {
        return [
            v[0] | 0,
            v[1] | 0,
            v[2] | 0
        ];
    }

    if (typeof v === "string") {
        const s = v.trim();

        if (s.charAt(0) === "#") {
            return hexToRgb(s);
        }

        const m = s.match(
            /(\d+)\D+(\d+)\D+(\d+)/
        );

        if (m) {
            return [
                parseInt(m[1], 10),
                parseInt(m[2], 10),
                parseInt(m[3], 10)
            ];
        }
    }

    return [0, 0, 0];
}

// Shutdown

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
                        data: { value: 0 }
                    }
                });
            }
        }
    } catch (e) {
        // Best effort shutdown.
    }
}

// Govee network discovery

export function DiscoveryService() {
    this.IconUrl = null;
    this.lastPollTime = -10000;
    this.PollInterval = 5000;
    this.controllers = {};

    this.Initialize = function () {
        service.log(
            "Govee Custom discovery starting (v" +
            Version() + ")"
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
                "discovery socket error: " + msg
            );
        });

        service.log(
            "Binding UDP " + PORT_LISTEN
        );

        this.sock.bind(PORT_LISTEN);
    };

    this.sendScan = function () {
        const scan = {
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

        for (const t of targets) {
            try {
                this.sock.write(
                    scan,
                    t,
                    PORT_SCAN
                );
            } catch (e) {
                // Continue to remaining targets.
            }
        }
    };

    this.onMessage = function (value) {
        if (!value || !value.data) return;

        let resp;

        try {
            resp = JSON.parse(value.data);
        } catch (e) {
            return;
        }

        if (
            !resp.msg ||
            resp.msg.cmd !== "scan" ||
            !resp.msg.data
        ) {
            return;
        }

        const d = resp.msg.data;
        const ip = d.ip || this.ipOf(value.address);

        if (!ip || !d.device) return;

        if (!this.controllers[ip]) {
            const prof = profileForSku(d.sku);

            const ctrl = {
                id: d.device,
                ip: ip,
                sku: d.sku || null,
                protocol: prof.protocol,
                ledCount: prof.leds,
                name:
                    "Govee " +
                    (d.sku || "device") +
                    " (" + prof.label + ")"
            };

            this.controllers[ip] = ctrl;

            service.log(
                "Discovered " +
                ctrl.name + " @ " + ip
            );

            service.addController(ctrl);
            service.announceController(ctrl);
            this.saveCache();
        } else {
            this.controllers[ip].ip = ip;

            service.updateController(
                this.controllers[ip]
            );
        }
    };

    this.Update = function (force) {
        const now = Date.now();

        if (
            force === true ||
            now - this.lastPollTime > this.PollInterval
        ) {
            this.lastPollTime = now;
            this.sendScan();
        }
    };

    this.ipOf = function (address) {
        if (!address) return null;

        const m = address.match(
            /(\d{1,3}\.){3}\d{1,3}/
        );

        return m ? m[0] : null;
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

                this.controllers[ip] = ctrl;

                service.addController(ctrl);
                service.announceController(ctrl);

                service.log(
                    "Restored cached " +
                    (ctrl.name || ip)
                );
            }
        } catch (e) {
            // Ignore cache errors.
        }
    };
}
