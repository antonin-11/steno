// Exporte les PNG et l'icône macOS (.icns) de Sténo à partir des SVG de brand/
// Lancé par Electron (pnpm run build:brand), qui sert de moteur de rendu et garde la transparence
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { app, BrowserWindow } = require("electron");

const BRAND = path.join(__dirname, "..", "brand");
const ICON_SVG = path.join(BRAND, "icon", "steno-icon.svg");
const ICON_SIZES = [16, 32, 64, 128, 256, 512, 1024];
// Logo à plat exporté en PNG, 20 fois sa taille de référence (54 x 50)
const LOGO_SCALE = 20;

// Noms attendus par iconutil dans le dossier .iconset, avec leur taille en pixels
const ICONSET = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steno-brand-"));
// Ni dossier de données ni icône dans le Dock pour ce script
app.setPath("userData", path.join(tmp, "data"));
app.dock?.hide();

// Dessine un SVG à la taille voulue sur fond transparent et renvoie le PNG
async function render(win, svgFile, width, height) {
    const svg = fs.readFileSync(svgFile).toString("base64");
    const html = `<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${svg}" width="${width}" height="${height}" style="display:block"></body>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    // Sur un écran Retina la capture est en 2x : on revient à la taille exacte
    const size = image.getSize();
    return (size.width === width ? image : image.resize({ width, height, quality: "best" })).toPNG();
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1100,
        height: 1100,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        // Rendu en 2x comme sur un écran Retina, puis réduit à la taille exacte : Electron 42+ rend en 1x par défaut
        webPreferences: { offscreen: { deviceScaleFactor: 2 } },
    });

    const pngDir = path.join(BRAND, "icon", "png");
    fs.mkdirSync(pngDir, { recursive: true });
    for (const size of ICON_SIZES) {
        fs.writeFileSync(path.join(pngDir, `steno-icon-${size}.png`), await render(win, ICON_SVG, size, size));
    }

    const iconset = path.join(tmp, "steno.iconset");
    fs.mkdirSync(iconset);
    for (const [name, size] of ICONSET) {
        fs.copyFileSync(path.join(pngDir, `steno-icon-${size}.png`), path.join(iconset, name));
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(BRAND, "icon", "steno-icon.icns")]);

    for (const name of ["steno-logo", "steno-logo-black", "steno-logo-white"]) {
        const png = await render(win, path.join(BRAND, "logo", `${name}.svg`), 54 * LOGO_SCALE, 50 * LOGO_SCALE);
        fs.writeFileSync(path.join(BRAND, "logo", `${name}.png`), png);
    }

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("Fichiers exportés dans brand/");
    app.quit();
});
