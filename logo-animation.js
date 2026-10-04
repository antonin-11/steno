// Morphing du mot « Sténo » en son logo, tout au trait, jouable dans les deux sens.
// Partagé par l'écran de lancement (app.html) et la page de marque (brand/animation/steno-animation.html).
//
// Tout est en unités de police : « Sténo » en corps 100, ligne de base à y = 0.
// Les lettres sont calées sur SF Pro Rounded semi-gras, avec le trait rond du logo.
// Au repos, le mot est centré sur l'origine ; à la fin du morphing, c'est le logo (agrandi 1,35 fois).
function createLogoMorph(container) {
    const INK = "#1f1f1e";
    const TERRACOTTA = "#c96d4e";
    const STROKE = 13;

    // Le logo (brand/logo/steno-logo.svg) est dessiné en 54 x 50 avec un trait de 8 :
    // on l'agrandit pour que son trait ait l'épaisseur des lettres.
    const LOGO_SCALE = STROKE / 8;
    const LOGO_WAVE = "M4 10C6.5 6.93 8.89 4 11.67 4C14.44 4 16.83 6.93 19.33 10C21.83 13.07 24.23 16 27 16C29.77 16 32.17 13.07 34.67 10C37.17 6.93 39.56 4 42.33 4C45.11 4 47.5 6.93 50 10";

    // Le t ne fait que basculer sur place : le logo se construit autour de lui
    const T_CENTER = [78.7, -33];
    const LOGO_ORIGIN = [T_CENTER[0] - 27 * LOGO_SCALE, T_CENTER[1] - 30 * LOGO_SCALE];
    const logo = (x, y) => [LOGO_ORIGIN[0] + x * LOGO_SCALE, LOGO_ORIGIN[1] + y * LOGO_SCALE];

    // Encombrement du mot au trait (du S à l'o, du haut du S à la ligne de base), sans l'accent
    const WORD = { left: 4.2, right: 264.85, top: -72.25, bottom: 1.75 };

    // La caméra part du centre du mot et finit au centre du logo
    const CAMERA_FROM = [(WORD.left + WORD.right) / 2, (WORD.top + WORD.bottom) / 2];
    const CAMERA_TO = logo(27, 25);
    const ZOOM_TO = 1.35;

    const LETTERS = {
        s: "M51.4 -54.3C47.5 -61.6 40 -65.75 31.8 -65.75C20.9 -65.75 12.1 -59.2 12.1 -50.4C12.1 -42.6 18.5 -38.6 32 -35.8C45.6 -33 52.6 -29.2 52.6 -20.6C52.6 -11.6 43.6 -4.75 31.8 -4.75C21.6 -4.75 14 -9.6 10.7 -16.4",
        tStem: "M78.7 -58.5L78.7 -15C78.7 -8.6 82.4 -5.9 89.8 -5.9",
        tBar: "M70 -46.9L89.6 -46.9",
        accent: "M127.6 -62.4L135.1 -71.8",
        e: "M108 -27.5H143.9C143.9 -40.4 136.3 -48.2 126 -48.2C114.9 -48.2 107.7 -39.4 107.7 -26.2C107.7 -12.9 114.9 -4.2 126.6 -4.2C133.6 -4.2 139.1 -6.9 142.6 -12.4",
        nStem: "M165.1 -6V-46.4",
        nArch: "M165.4 -33C165.6 -42 172.4 -47.4 182 -47.4C193.4 -47.4 199.5 -41.3 199.5 -31.5V-6",
        o: "M239.65 -48C250.5 -48 258.35 -39.2 258.35 -26.2C258.35 -13.2 250.5 -4.4 239.65 -4.4C228.8 -4.4 220.95 -13.2 220.95 -26.2C220.95 -39.2 228.8 -48 239.65 -48Z",
    };

    /* ---------- Éléments SVG ---------- */

    function svg(tag, attributes, parent) {
        const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
        parent.appendChild(node);
        return node;
    }

    const camera = svg("g", { fill: "none", "stroke-width": STROKE, "stroke-linecap": "round", "stroke-linejoin": "round" }, container);
    const erased = {};
    for (const name of ["o", "nArch", "nStem", "e"]) {
        erased[name] = svg("path", { d: LETTERS[name], pathLength: 1, stroke: INK }, camera);
    }
    const tGroup = svg("g", {}, camera);
    const tBarPath = svg("path", {}, tGroup);
    const tStemPath = svg("path", {}, tGroup);
    const accentGroup = svg("g", {}, camera);
    const accentPath = svg("path", {}, accentGroup);
    const sGroup = svg("g", {}, camera);
    const sPath = svg("path", {}, sGroup);

    /* ---------- Géométrie ---------- */

    // Un tracé = une suite de points de courbes de Bézier cubiques : départ, puis 3 points par courbe.
    function parseCubic(d) {
        const tokens = d.match(/[MLC]|-?[\d.]+/g);
        const points = [];
        let command;
        for (let i = 0; i < tokens.length; ) {
            if (/[MLC]/.test(tokens[i])) command = tokens[i++];
            const take = () => [Number(tokens[i++]), Number(tokens[i++])];
            if (command === "M") points.push(take());
            if (command === "L") points.push(...line(points[points.length - 1], take()).slice(1));
            if (command === "C") points.push(take(), take(), take());
        }
        return points;
    }

    // Un segment droit écrit comme une courbe, pour se morpher avec les autres
    function line(a, b) {
        return [a, lerpPoint(a, b, 1 / 3), lerpPoint(a, b, 2 / 3), b];
    }

    const format = (p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;

    function cubicPath(points) {
        let d = `M${format(points[0])}`;
        for (let i = 1; i < points.length; i += 3) d += `C${format(points[i])} ${format(points[i + 1])} ${format(points[i + 2])}`;
        return d;
    }

    const polylinePath = (points) => `M${points.map(format).join("L")}`;

    const lerp = (a, b, t) => a + (b - a) * t;
    const lerpPoint = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

    function rotate([x, y], degrees) {
        const r = (degrees * Math.PI) / 180;
        return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
    }

    function bezierPoint(a, b, c, d, t) {
        const m = 1 - t;
        const mix = (i) => m ** 3 * a[i] + 3 * m * m * t * b[i] + 3 * m * t * t * c[i] + t ** 3 * d[i];
        return [mix(0), mix(1)];
    }

    // `count` points régulièrement espacés le long du trait
    function sampleEvenly(points, count) {
        const dense = [];
        for (let i = 0; i + 3 < points.length; i += 3) {
            for (let j = 0; j < 64; j++) dense.push(bezierPoint(...points.slice(i, i + 4), j / 64));
        }
        dense.push(points[points.length - 1]);
        const lengths = [0];
        for (let i = 1; i < dense.length; i++) lengths.push(lengths[i - 1] + distance(dense[i - 1], dense[i]));
        const total = lengths[lengths.length - 1];
        const samples = [];
        let j = 0;
        for (let i = 0; i < count; i++) {
            const at = (total * i) / (count - 1);
            while (j < dense.length - 2 && lengths[j + 1] < at) j++;
            samples.push(lerpPoint(dense[j], dense[j + 1], (at - lengths[j]) / (lengths[j + 1] - lengths[j] || 1)));
        }
        return samples;
    }

    // Le trait vu comme une suite de petits pas : la direction de chacun (sans saut d'un tour complet) et sa longueur
    function strides(samples) {
        const angles = [];
        const lengths = [];
        for (let i = 0; i < samples.length - 1; i++) {
            let angle = Math.atan2(samples[i + 1][1] - samples[i][1], samples[i + 1][0] - samples[i][0]);
            if (i > 0) angle += Math.round((angles[i - 1] - angle) / (2 * Math.PI)) * 2 * Math.PI;
            angles.push(angle);
            lengths.push(distance(samples[i], samples[i + 1]));
        }
        return { angles, lengths };
    }

    // Centre de gravité du trait, chaque pas pesant sa longueur
    function center(samples) {
        let weight = 0;
        let x = 0;
        let y = 0;
        for (let i = 0; i < samples.length - 1; i++) {
            const w = distance(samples[i], samples[i + 1]);
            weight += w;
            x += (w * (samples[i][0] + samples[i + 1][0])) / 2;
            y += (w * (samples[i][1] + samples[i + 1][1])) / 2;
        }
        return [x / weight, y / weight];
    }

    /* ---------- Morphings ---------- */

    // Deux tracés de même structure : on interpole leurs points un à un
    function pointMorph(from, to) {
        return (t) => cubicPath(from.map((p, i) => lerpPoint(p, to[i], t)));
    }

    // Morphing au fil du trait : chaque petit pas tourne et s'allonge de sa direction de départ
    // à celle d'arrivée, puis on remet les pas bout à bout. Le tracé se déroule comme un ruban
    // au lieu de s'écraser. Le tracé de départ devient les `share` premiers du tracé d'arrivée,
    // le reste pousse depuis son extrémité.
    function ribbonMorph(from, to, share, count = 181) {
        const target = sampleEvenly(to, count);
        const source = sampleEvenly(from, Math.round((count - 1) * share) + 1);
        const a = strides(source);
        const b = strides(target);
        while (a.angles.length < b.angles.length) {
            a.angles.push(a.angles[a.angles.length - 1]);
            a.lengths.push(0);
        }
        // Les deux tracés sur le même tour de cercle, pour tourner par le plus court
        const drift = a.angles.reduce((sum, angle, i) => sum + b.angles[i] - angle, 0) / a.angles.length;
        const turns = Math.round(drift / (2 * Math.PI)) * 2 * Math.PI;
        const [fromCenter, toCenter] = [center(source), center(target)];
        return (t) => {
            if (t <= 0) return cubicPath(from);
            if (t >= 1) return cubicPath(to);
            const points = [[0, 0]];
            a.angles.forEach((angle, i) => {
                const heading = lerp(angle, b.angles[i] - turns, t);
                const length = lerp(a.lengths[i], b.lengths[i], t);
                points.push([points[i][0] + length * Math.cos(heading), points[i][1] + length * Math.sin(heading)]);
            });
            const [cx, cy] = center(points);
            const [x, y] = lerpPoint(fromCenter, toCenter, t);
            return polylinePath(points.map((p) => [p[0] - cx + x, p[1] - cy + y]));
        };
    }

    /* ---------- Courbes d'accélération ---------- */

    // Même calcul que cubic-bezier() en CSS
    function cubicBezier(x1, y1, x2, y2) {
        const curve = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
        return (x) => {
            if (x <= 0) return 0;
            if (x >= 1) return 1;
            let low = 0;
            let high = 1;
            let t = x;
            for (let i = 0; i < 24; i++) {
                if (curve(x1, x2, t) < x) low = t;
                else high = t;
                t = (low + high) / 2;
            }
            return curve(y1, y2, t);
        };
    }

    const EASE = cubicBezier(0.7, 0, 0.25, 1);
    const EASE_OUT = cubicBezier(0.3, 0, 0.2, 1);

    function mixColor(a, b, t) {
        const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const [ca, cb] = [channels(a), channels(b)];
        return `rgb(${ca.map((c, i) => Math.round(lerp(c, cb[i], t))).join(",")})`;
    }

    /* ---------- Les trois lettres qui deviennent le logo ---------- */

    // Les pièces tournent autour du t dans le sens des aiguilles d'une montre, comme un moulinet :
    // le S monte, l'accent passe par la droite pour descendre sous le t.
    function orbit(from, to, t) {
        const polar = (p) => [distance(T_CENTER, p), Math.atan2(p[1] - T_CENTER[1], p[0] - T_CENTER[0])];
        const [r0, a0] = polar(from);
        let [r1, a1] = polar(to);
        while (a1 < a0) a1 += 2 * Math.PI;
        const r = lerp(r0, r1, t);
        const a = lerp(a0, a1, t);
        return [T_CENTER[0] + r * Math.cos(a), T_CENTER[1] + r * Math.sin(a)];
    }

    // Chaque pièce tourne sur elle-même autour de son pivot pendant que son tracé se déforme.
    // La forme d'arrivée est exprimée dans le repère de la pièce, avant rotation :
    // à la fin, pivot déplacé + rotation redonnent exactement le tracé du logo.
    function piece({ group, path, from, to, pivotFrom, pivotTo, turn, morph = pointMorph }) {
        const local = (points, pivot, angle) => points.map((p) => rotate([p[0] - pivot[0], p[1] - pivot[1]], -angle));
        const shapeAt = morph(local(from, pivotFrom, 0), local(to, pivotTo, turn));
        return {
            render(move, shape = move) {
                const [x, y] = orbit(pivotFrom, pivotTo, move);
                group.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(turn * move).toFixed(2)})`);
                path.setAttribute("d", shapeAt(shape));
            },
        };
    }

    // S → l'onde : il bascule d'un quart de tour vers la droite, son haut devient le bout droit de l'onde
    // (l'onde est donc parcourue de droite à gauche). Il forme les deux premières bosses
    // et la troisième pousse depuis son bout inférieur.
    const sPiece = piece({
        group: sGroup,
        path: sPath,
        from: parseCubic(LETTERS.s),
        to: parseCubic(LOGO_WAVE).map((p) => logo(...p)).reverse(),
        pivotFrom: [32.35, -35.25],
        pivotTo: logo(27, 10),
        turn: 90,
        morph: (from, to) => ribbonMorph(from, to, 2 / 3),
    });

    // t → la longue barre : le fût bascule à son tour d'un quart de tour, le crochet se déplie.
    // La barre est coupée au même endroit que le fût (fin de la partie droite, début du crochet).
    const barRight = logo(50, 30);
    const barLeft = logo(4, 30);
    const barSplit = lerpPoint(barRight, barLeft, 43.5 / (43.5 + 15.5));
    const tStemPiece = piece({
        group: tGroup,
        path: tStemPath,
        from: parseCubic(LETTERS.tStem),
        to: [...line(barRight, barSplit), ...line(barSplit, barLeft).slice(1)],
        pivotFrom: T_CENTER,
        pivotTo: T_CENTER,
        turn: 90,
    });
    // La barre du t se rétracte vers le point du fût qu'elle croise
    const crossing = lerpPoint(barRight, barSplit, (58.5 - 46.9) / 43.5);
    const tBarPiece = piece({
        group: tGroup,
        path: tBarPath,
        from: parseCubic(LETTERS.tBar),
        to: line(crossing, crossing),
        pivotFrom: T_CENTER,
        pivotTo: T_CENTER,
        turn: 90,
    });

    // Accent → la barre courte : il se couche et s'allonge
    const accent = parseCubic(LETTERS.accent);
    const accentAngle = (Math.atan2(accent[3][1] - accent[0][1], accent[3][0] - accent[0][0]) * 180) / Math.PI;
    const accentPiece = piece({
        group: accentGroup,
        path: accentPath,
        from: accent,
        to: line(logo(4, 46), logo(32, 46)),
        pivotFrom: lerpPoint(accent[0], accent[3], 0.5),
        pivotTo: logo(18, 46),
        turn: -accentAngle,
    });

    /* ---------- Les lettres qui s'effacent ---------- */

    // Effacées au trait (pathLength = 1) : `fromEnd` rembobine le tracé depuis sa fin,
    // sinon c'est son début qui court après sa fin
    function erase(path, amount, fromEnd) {
        path.style.strokeDasharray = "1 2";
        path.style.strokeDashoffset = fromEnd ? amount : -amount;
        // Le trait s'affine sur la fin : il ne reste pas de point rond
        path.style.strokeWidth = STROKE * Math.min(1, (1 - amount) / 0.18);
    }

    /* ---------- Timeline ---------- */

    const DURATION = 1.75;

    // L'encre vire au terracotta pendant le cœur du mouvement, pas en traînant
    const tint = (move) => mixColor(INK, TERRACOTTA, Math.min(1, Math.max(0, (move - 0.25) / 0.6)));

    // Mot → logo de 0 à DURATION secondes. À rebours (logo → mot), les étapes se rejouent
    // dans l'ordre inverse en gardant leur courbe : un trait qui se redessine ralentit en arrivant.
    function render(time, reverse = false) {
        const t = reverse ? DURATION - time : time;
        const progress = (start, duration, ease = EASE) => {
            const raw = Math.min(1, Math.max(0, (t - start) / duration));
            return reverse ? 1 - ease(1 - raw) : ease(raw);
        };

        erase(erased.o, progress(0, 0.6, EASE_OUT));
        erase(erased.nArch, progress(0.04, 0.45, EASE_OUT), true);
        erase(erased.nStem, progress(0.22, 0.4, EASE_OUT), true);
        erase(erased.e, progress(0.1, 0.6, EASE_OUT));

        const s = progress(0.1, 1.4);
        const tt = progress(0.18, 1.4);
        const ac = progress(0.26, 1.4);
        sPiece.render(s);
        tStemPiece.render(tt);
        tBarPiece.render(tt, progress(0.18, 0.8));
        accentPiece.render(ac);
        tBarPath.style.opacity = tt < 1 ? 1 : 0;

        sPath.style.stroke = tint(s);
        tStemPath.style.stroke = tBarPath.style.stroke = tint(tt);
        accentPath.style.stroke = tint(ac);

        const cam = progress(0.1, 1.65);
        const [cx, cy] = lerpPoint(CAMERA_FROM, CAMERA_TO, cam);
        const zoom = lerp(1, ZOOM_TO, cam);
        camera.setAttribute("transform", `scale(${zoom.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`);
    }

    return {
        duration: DURATION,
        render,
        cubicBezier,
        // Taille du mot au repos et échelle du logo, pour composer autour (logo + mot côte à côte)
        word: { width: WORD.right - WORD.left, height: WORD.bottom - WORD.top },
        logoScale: LOGO_SCALE,
    };
}
