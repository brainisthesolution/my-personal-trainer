import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const libraryPath = path.join(root, "data", "exercise-library.json");
const outDir = path.join(root, "assets", "exercises");

const data = JSON.parse(fs.readFileSync(libraryPath, "utf8"));

const palettes = {
  "Riscaldamento": ["#d9f0e2", "#2f8d6f", "#f2a65a"],
  "Parte superiore": ["#dceefa", "#2d79a3", "#e99191"],
  "Parte inferiore": ["#e9edcf", "#748b35", "#dd9e4f"],
  "Core": ["#efe2f4", "#7f5fa6", "#efb35b"],
  "Schiena/Postura": ["#ddeae7", "#427772", "#d98c77"],
  "Stretching": ["#f7e4da", "#b5644d", "#7aa878"],
  "Full body": ["#e5e8fb", "#526eb8", "#e0a84e"]
};

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function filenameFromImage(image) {
  return path.basename(image).replace(/\.(jpg|jpeg|png|webp|svg)$/i, ".svg");
}

function cleanName(name) {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function shortLabel(name) {
  const text = name.replace(/\([^)]*\)/g, "").replace(/\s+2v$/i, "").trim();
  return text.length > 30 ? `${text.slice(0, 27).trim()}...` : text;
}

function poseFor(name, category) {
  const text = cleanName(name);
  if (text.includes("90/90")) return "seated-90";
  if (text.includes("affondo profondo")) return "cossack";
  if (text.includes("affondi indietro")) return "reverse-lunge";
  if (text.includes("affondi")) return "forward-lunge";
  if (text.includes("sumo squat")) return "sumo-squat";
  if (text.includes("slancio all'indietro")) return "squat-kickback";
  if (text.includes("sollevamento polpacci")) return "calf-squat";
  if (text.includes("squat")) return "squat";
  if (text.includes("push-up a presa stretta al muro")) return "wall-pushup";
  if (text.includes("cane a testa in giu")) return "pushup-dog";
  if (text.includes("push-up") || text.includes("push up")) return "knee-pushup";
  if (text.includes("tocco alle spalle")) return "shoulder-tap";
  if (text.includes("plank lean")) return "plank-lean";
  if (text.includes("plank")) return "forearm-plank";
  if (text.includes("bird dog")) return "bird-dog";
  if (text.includes("donkey kick")) return "donkey-kick";
  if (text.includes("gatto")) return "cat-cow";
  if (text.includes("quadrupedia")) return "quadruped-shift";
  if (text.includes("marcia in ponte")) return "bridge-march";
  if (text.includes("ponte glutei")) return text.includes("difficile") ? "single-bridge" : "bridge";
  if (text.includes("crunch a bicicletta")) return "bicycle";
  if (text.includes("crunch laterale")) return text.includes("sinistra") ? "standing-crunch-left" : "standing-crunch-right";
  if (text.includes("dead bug")) return "dead-bug";
  if (text.includes("tocco dei talloni")) return "heel-taps";
  if (text.includes("tocco delle punte")) return "toe-touch";
  if (text.includes("shadow boxing")) return "boxing";
  if (text.includes("burpee")) return "burpee";
  if (text.includes("cerniera")) return "hip-hinge";
  if (text.includes("rotazioni del collo")) return "neck-rotation";
  if (text.includes("rotazioni del bacino")) return "hip-circles";
  if (text.includes("rotazioni dei gomiti")) return "elbow-circles";
  if (text.includes("rotazioni delle braccia")) return "arm-circles";
  if (text.includes("aperture del petto")) return "chest-open";
  if (text.includes("flessioni laterali")) return "side-bends";
  if (text.includes("riscaldamento dei polsi")) return "wrist-warmup";
  if (text.includes("roll down")) return "roll-down";
  if (text.includes("wall sit")) return "wall-sit";
  if (text.includes("scivolamenti scapolari")) return "wall-slides";
  if (text.includes("floor angels")) return "floor-angels";
  if (text.includes("snow angels")) return "snow-angels";
  if (text.includes("back widows")) return text.includes("ginocchia") ? "back-widow-bent" : "back-widow";
  if (text.includes("contrazione isometrica")) return "lat-squeeze";
  if (text.includes("alzate a t")) return "prone-t";
  if (text.includes("alzate a w")) return "prone-w";
  if (text.includes("alzate a y")) return "prone-y";
  if (text.includes("sollevamenti proni")) return "prone-alternate";
  if (text.includes("posizione del bambino")) return "child";
  if (text.includes("farfalla")) return "butterfly";
  if (text.includes("polpacci")) return "active-hamstring";
  if (text.includes("bicipiti femorali")) return "seated-hamstring";
  if (text.includes("dorsali sopra")) return "lat-stretch";
  if (text.includes("spalla incrociato")) return "cross-shoulder";
  if (text.includes("ginocchia al petto")) return "knees-to-chest";
  if (text.includes("torsioni spinali")) return "spinal-twist";
  if (text.includes("cobra")) return "cobra";
  if (category === "Stretching") return "stretch";
  return "standing";
}

const p = (x, y) => ({ x, y });

function limb(points, color, width = 20) {
  const d = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function guide(d, color) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)"/>`;
}

function body(color, j, opts = {}) {
  const skin = "#f5c6aa";
  const suit = opts.suit || color;
  const torso = j.shoulder && j.hip ? limb([j.shoulder, j.hip], suit, 34) : "";
  const neck = j.head && j.shoulder ? limb([p(j.head.x, j.head.y + 24), j.shoulder], suit, 12) : "";
  const leftArm = j.leftElbow ? limb([j.shoulder, j.leftElbow, j.leftHand], suit, 18) : "";
  const rightArm = j.rightElbow ? limb([j.shoulder, j.rightElbow, j.rightHand], suit, 18) : "";
  const leftLeg = j.leftKnee ? limb([j.hip, j.leftKnee, j.leftFoot], suit, 22) : "";
  const rightLeg = j.rightKnee ? limb([j.hip, j.rightKnee, j.rightFoot], suit, 22) : "";
  const ghost = opts.ghost ? `<g opacity=".18">${opts.ghost}</g>` : "";
  const head = j.head ? `<circle cx="${j.head.x}" cy="${j.head.y}" r="${opts.headSize || 25}" fill="${skin}" stroke="${suit}" stroke-width="6"/>` : "";
  const hands = [j.leftHand, j.rightHand, j.leftFoot, j.rightFoot]
    .filter(Boolean)
    .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="8" fill="${suit}" opacity=".9"/>`)
    .join("");

  return `<g>${ghost}${leftLeg}${rightLeg}${torso}${neck}${leftArm}${rightArm}${head}${hands}</g>`;
}

const stand = {
  head: p(480, 160), shoulder: p(480, 250), hip: p(470, 392),
  leftElbow: p(396, 286), leftHand: p(330, 322),
  rightElbow: p(566, 286), rightHand: p(632, 322),
  leftKnee: p(420, 484), leftFoot: p(386, 564),
  rightKnee: p(526, 484), rightFoot: p(566, 564)
};

function context(pose, accent, warm) {
  const mat = `<rect x="105" y="492" width="750" height="62" rx="31" fill="#fff" opacity=".62"/>`;
  const wall = `<rect x="710" y="86" width="58" height="430" rx="18" fill="${accent}" opacity=".14"/>`;
  const floor = `<path d="M118 512 C298 460 422 482 548 518 C664 552 768 526 860 470" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" opacity=".46"/>`;
  const disc = `<circle cx="792" cy="124" r="96" fill="${warm}" opacity=".28"/>`;
  if (pose.includes("wall")) return `${wall}${mat}`;
  if (/(plank|pushup|bridge|floor|back-widow|prone|dead|bicycle|heel|toe|child|cobra|knees|twist)/.test(pose)) return `${mat}${disc}`;
  return `${floor}${disc}`;
}

function art(pose, accent, warm) {
  const h = (j, opts) => body(accent, j, opts);
  const ghostSquat = h({
    head: p(476, 142), shoulder: p(476, 240), hip: p(476, 374),
    leftElbow: p(392, 260), leftHand: p(326, 282),
    rightElbow: p(560, 260), rightHand: p(626, 282),
    leftKnee: p(426, 480), leftFoot: p(382, 560),
    rightKnee: p(528, 480), rightFoot: p(576, 560)
  });

  const poses = {
    standing: h(stand),
    squat: `${h({
      head: p(476, 172), shoulder: p(476, 262), hip: p(462, 390),
      leftElbow: p(392, 280), leftHand: p(334, 304),
      rightElbow: p(560, 280), rightHand: p(620, 304),
      leftKnee: p(380, 448), leftFoot: p(276, 448),
      rightKnee: p(550, 448), rightFoot: p(662, 448)
    }, { ghost: ghostSquat })}${guide("M720 214 C765 292 764 390 718 466", warm)}`,
    "sumo-squat": h({
      head: p(476, 178), shoulder: p(476, 268), hip: p(466, 394),
      leftElbow: p(398, 290), leftHand: p(342, 330),
      rightElbow: p(554, 290), rightHand: p(620, 330),
      leftKnee: p(350, 454), leftFoot: p(210, 454),
      rightKnee: p(582, 454), rightFoot: p(730, 454)
    }),
    "calf-squat": `${h({
      head: p(476, 172), shoulder: p(476, 262), hip: p(462, 390),
      leftElbow: p(392, 280), leftHand: p(334, 304),
      rightElbow: p(560, 280), rightHand: p(620, 304),
      leftKnee: p(380, 448), leftFoot: p(288, 436),
      rightKnee: p(550, 448), rightFoot: p(650, 436)
    })}${guide("M742 486 L742 354", warm)}`,
    "squat-kickback": `${h({
      head: p(430, 168), shoulder: p(440, 260), hip: p(420, 390),
      leftElbow: p(364, 290), leftHand: p(316, 334),
      rightElbow: p(516, 284), rightHand: p(584, 314),
      leftKnee: p(360, 456), leftFoot: p(260, 456),
      rightKnee: p(560, 390), rightFoot: p(736, 366)
    })}${guide("M608 394 C690 368 746 324 786 260", warm)}`,
    "forward-lunge": h({
      head: p(482, 144), shoulder: p(482, 244), hip: p(460, 380),
      leftElbow: p(406, 282), leftHand: p(356, 330),
      rightElbow: p(560, 282), rightHand: p(626, 318),
      leftKnee: p(338, 446), leftFoot: p(218, 446),
      rightKnee: p(606, 466), rightFoot: p(720, 466)
    }),
    "reverse-lunge": h({
      head: p(472, 144), shoulder: p(472, 244), hip: p(460, 380),
      leftElbow: p(392, 280), leftHand: p(332, 318),
      rightElbow: p(548, 282), rightHand: p(620, 330),
      leftKnee: p(356, 464), leftFoot: p(240, 464),
      rightKnee: p(606, 440), rightFoot: p(756, 486)
    }),
    cossack: h({
      head: p(396, 198), shoulder: p(396, 282), hip: p(388, 410),
      leftElbow: p(318, 306), leftHand: p(250, 336),
      rightElbow: p(478, 306), rightHand: p(560, 334),
      leftKnee: p(284, 456), leftFoot: p(190, 456),
      rightKnee: p(572, 436), rightFoot: p(792, 436)
    }),
    "knee-pushup": `${h({
      head: p(260, 300), shoulder: p(350, 330), hip: p(552, 382),
      leftElbow: p(340, 426), leftHand: p(324, 506),
      rightElbow: p(574, 448), rightHand: p(558, 522),
      leftKnee: p(660, 456), leftFoot: p(758, 486),
      rightKnee: p(660, 456), rightFoot: p(770, 450)
    })}${guide("M242 406 C216 462 230 512 278 548", warm)}`,
    "pushup-dog": `${h({
      head: p(256, 308), shoulder: p(350, 334), hip: p(558, 214),
      leftElbow: p(342, 430), leftHand: p(324, 510),
      rightElbow: p(594, 318), rightHand: p(664, 512),
      leftKnee: p(646, 350), leftFoot: p(770, 490),
      rightKnee: p(646, 350), rightFoot: p(770, 490)
    })}${guide("M548 442 C520 344 530 262 584 198", warm)}`,
    "wall-pushup": `${h({
      head: p(450, 184), shoulder: p(466, 274), hip: p(392, 410),
      leftElbow: p(560, 276), leftHand: p(694, 254),
      rightElbow: p(566, 334), rightHand: p(694, 334),
      leftKnee: p(352, 478), leftFoot: p(270, 548),
      rightKnee: p(440, 480), rightFoot: p(374, 548)
    })}${guide("M628 220 C694 250 698 330 640 374", warm)}`,
    "forearm-plank": h({
      head: p(248, 306), shoulder: p(330, 338), hip: p(592, 390),
      leftElbow: p(300, 448), leftHand: p(392, 452),
      rightElbow: p(300, 448), rightHand: p(392, 452),
      leftKnee: p(692, 438), leftFoot: p(792, 438),
      rightKnee: p(692, 438), rightFoot: p(792, 438)
    }),
    "plank-lean": `${h({
      head: p(248, 298), shoulder: p(334, 328), hip: p(610, 374),
      leftElbow: p(378, 420), leftHand: p(422, 508),
      rightElbow: p(378, 420), rightHand: p(422, 508),
      leftKnee: p(706, 432), leftFoot: p(804, 432),
      rightKnee: p(706, 432), rightFoot: p(804, 432)
    })}${guide("M458 246 C552 230 646 258 710 322", warm)}`,
    "shoulder-tap": `${h({
      head: p(250, 300), shoulder: p(334, 330), hip: p(586, 382),
      leftElbow: p(370, 412), leftHand: p(446, 316),
      rightElbow: p(604, 446), rightHand: p(604, 522),
      leftKnee: p(686, 448), leftFoot: p(786, 448),
      rightKnee: p(686, 448), rightFoot: p(786, 448)
    })}${guide("M418 350 C458 306 512 290 566 306", warm)}`,
    "bird-dog": h({
      head: p(274, 254), shoulder: p(350, 296), hip: p(582, 336),
      leftElbow: p(332, 416), leftHand: p(314, 518),
      rightElbow: p(684, 248), rightHand: p(810, 166),
      leftKnee: p(520, 440), leftFoot: p(500, 530),
      rightKnee: p(662, 336), rightFoot: p(808, 438)
    }),
    "donkey-kick": `${h({
      head: p(280, 256), shoulder: p(356, 298), hip: p(572, 340),
      leftElbow: p(342, 416), leftHand: p(324, 520),
      rightElbow: p(426, 420), rightHand: p(408, 520),
      leftKnee: p(520, 446), leftFoot: p(500, 530),
      rightKnee: p(672, 262), rightFoot: p(812, 242)
    })}${guide("M654 310 C704 260 754 230 824 214", warm)}`,
    "cat-cow": `${h({
      head: p(282, 280), shoulder: p(360, 322), hip: p(584, 318),
      leftElbow: p(342, 430), leftHand: p(324, 522),
      rightElbow: p(430, 432), rightHand: p(412, 522),
      leftKnee: p(536, 444), leftFoot: p(516, 528),
      rightKnee: p(660, 444), rightFoot: p(640, 528)
    })}${guide("M390 256 C470 210 570 218 646 262", warm)}`,
    "quadruped-shift": `${h({
      head: p(286, 264), shoulder: p(362, 310), hip: p(586, 334),
      leftElbow: p(344, 424), leftHand: p(326, 520),
      rightElbow: p(434, 426), rightHand: p(416, 520),
      leftKnee: p(540, 444), leftFoot: p(520, 530),
      rightKnee: p(664, 444), rightFoot: p(644, 530)
    })}${guide("M430 220 C526 190 640 204 720 248", warm)}${guide("M710 270 C614 304 500 310 420 276", warm)}`,
    bridge: h({
      head: p(240, 420), shoulder: p(330, 424), hip: p(506, 330),
      leftElbow: p(300, 472), leftHand: p(244, 486),
      rightElbow: p(386, 472), rightHand: p(444, 486),
      leftKnee: p(636, 404), leftFoot: p(728, 488),
      rightKnee: p(618, 412), rightFoot: p(804, 488)
    }),
    "single-bridge": h({
      head: p(240, 420), shoulder: p(330, 424), hip: p(506, 330),
      leftElbow: p(300, 472), leftHand: p(244, 486),
      rightElbow: p(386, 472), rightHand: p(444, 486),
      leftKnee: p(636, 404), leftFoot: p(728, 488),
      rightKnee: p(584, 260), rightFoot: p(660, 172)
    }),
    "bridge-march": `${h({
      head: p(240, 420), shoulder: p(330, 424), hip: p(506, 330),
      leftElbow: p(300, 472), leftHand: p(244, 486),
      rightElbow: p(386, 472), rightHand: p(444, 486),
      leftKnee: p(636, 404), leftFoot: p(728, 488),
      rightKnee: p(596, 286), rightFoot: p(690, 286)
    })}${guide("M666 376 C710 336 716 286 690 238", warm)}`,
    bicycle: h({
      head: p(236, 420), shoulder: p(332, 396), hip: p(472, 416),
      leftElbow: p(378, 326), leftHand: p(426, 272),
      rightElbow: p(268, 350), rightHand: p(230, 284),
      leftKnee: p(576, 332), leftFoot: p(684, 260),
      rightKnee: p(610, 466), rightFoot: p(760, 486)
    }),
    "dead-bug": h({
      head: p(420, 438), shoulder: p(470, 404), hip: p(514, 410),
      leftElbow: p(370, 310), leftHand: p(300, 230),
      rightElbow: p(588, 310), rightHand: p(666, 230),
      leftKnee: p(430, 310), leftFoot: p(370, 220),
      rightKnee: p(608, 320), rightFoot: p(692, 250)
    }),
    "heel-taps": `${h({
      head: p(250, 430), shoulder: p(340, 416), hip: p(480, 430),
      leftElbow: p(286, 468), leftHand: p(218, 488),
      rightElbow: p(480, 472), rightHand: p(574, 488),
      leftKnee: p(616, 412), leftFoot: p(700, 488),
      rightKnee: p(636, 412), rightFoot: p(812, 488)
    })}${guide("M268 470 C216 458 178 476 152 516", warm)}`,
    "toe-touch": h({
      head: p(250, 410), shoulder: p(350, 378), hip: p(470, 410),
      leftElbow: p(428, 304), leftHand: p(512, 244),
      rightElbow: p(480, 318), rightHand: p(590, 244),
      leftKnee: p(560, 286), leftFoot: p(616, 180),
      rightKnee: p(640, 344), rightFoot: p(748, 264)
    }),
    "standing-crunch-right": `${h({
      head: p(464, 156), shoulder: p(464, 246), hip: p(452, 384),
      leftElbow: p(390, 212), leftHand: p(348, 156),
      rightElbow: p(536, 212), rightHand: p(590, 156),
      leftKnee: p(406, 482), leftFoot: p(382, 564),
      rightKnee: p(570, 324), rightFoot: p(642, 286)
    })}${guide("M638 222 C692 270 696 354 652 418", warm)}`,
    "standing-crunch-left": `${h({
      head: p(496, 156), shoulder: p(496, 246), hip: p(508, 384),
      leftElbow: p(424, 212), leftHand: p(370, 156),
      rightElbow: p(570, 212), rightHand: p(612, 156),
      leftKnee: p(390, 324), leftFoot: p(318, 286),
      rightKnee: p(554, 482), rightFoot: p(578, 564)
    })}${guide("M320 222 C266 270 262 354 306 418", warm)}`,
    boxing: `${h({
      head: p(476, 154), shoulder: p(476, 244), hip: p(456, 390),
      leftElbow: p(394, 258), leftHand: p(290, 248),
      rightElbow: p(554, 246), rightHand: p(696, 214),
      leftKnee: p(402, 482), leftFoot: p(326, 556),
      rightKnee: p(540, 476), rightFoot: p(636, 534)
    })}<circle cx="290" cy="248" r="24" fill="${warm}"/><circle cx="696" cy="214" r="24" fill="${warm}"/>`,
    burpee: `${h({
      head: p(250, 296), shoulder: p(334, 332), hip: p(584, 380),
      leftElbow: p(378, 432), leftHand: p(418, 510),
      rightElbow: p(378, 432), rightHand: p(418, 510),
      leftKnee: p(686, 448), leftFoot: p(800, 448),
      rightKnee: p(620, 448), rightFoot: p(714, 518)
    })}${guide("M350 190 C462 116 622 130 720 216", warm)}`,
    "hip-hinge": `${h({
      head: p(404, 220), shoulder: p(448, 292), hip: p(522, 402),
      leftElbow: p(398, 334), leftHand: p(340, 392),
      rightElbow: p(498, 324), rightHand: p(548, 384),
      leftKnee: p(474, 476), leftFoot: p(430, 558),
      rightKnee: p(570, 476), rightFoot: p(610, 558)
    })}${guide("M566 190 C626 254 644 336 610 424", warm)}`,
    "arm-circles": `${h(stand)}${guide("M294 250 C230 160 286 72 384 88", warm)}${guide("M666 250 C730 160 674 72 576 88", warm)}`,
    "elbow-circles": `${h({ ...stand, leftElbow: p(400, 240), leftHand: p(382, 316), rightElbow: p(560, 240), rightHand: p(578, 316) })}${guide("M350 258 C326 216 352 176 400 178", warm)}${guide("M610 258 C634 216 608 176 560 178", warm)}`,
    "neck-rotation": `${h(stand)}${guide("M398 138 C430 78 518 74 562 128", warm)}`,
    "hip-circles": `${h(stand)}${guide("M388 388 C424 320 538 320 574 390", warm)}`,
    "chest-open": `${h({ ...stand, leftElbow: p(364, 238), leftHand: p(244, 218), rightElbow: p(596, 238), rightHand: p(716, 218) })}${guide("M288 206 C206 214 160 260 140 328", warm)}${guide("M672 206 C754 214 800 260 820 328", warm)}`,
    "side-bends": `${h({ ...stand, head: p(426, 168), shoulder: p(448, 252), hip: p(490, 392), leftElbow: p(390, 198), leftHand: p(350, 140), rightElbow: p(548, 306), rightHand: p(620, 340) })}${guide("M608 150 C686 236 686 352 610 436", warm)}`,
    "wrist-warmup": `${h({ ...stand, leftElbow: p(404, 282), leftHand: p(350, 282), rightElbow: p(556, 282), rightHand: p(610, 282) })}<circle cx="350" cy="282" r="34" fill="none" stroke="${warm}" stroke-width="8"/><circle cx="610" cy="282" r="34" fill="none" stroke="${warm}" stroke-width="8"/>`,
    "roll-down": `${h({
      head: p(356, 302), shoulder: p(412, 342), hip: p(496, 390),
      leftElbow: p(380, 416), leftHand: p(332, 488),
      rightElbow: p(456, 416), rightHand: p(418, 488),
      leftKnee: p(466, 478), leftFoot: p(430, 558),
      rightKnee: p(544, 478), rightFoot: p(580, 558)
    })}${guide("M440 162 C356 208 330 260 354 322", warm)}`,
    "wall-sit": h({
      head: p(520, 182), shoulder: p(548, 272), hip: p(638, 384),
      leftElbow: p(498, 316), leftHand: p(454, 374),
      rightElbow: p(594, 316), rightHand: p(638, 374),
      leftKnee: p(492, 456), leftFoot: p(350, 456),
      rightKnee: p(642, 456), rightFoot: p(774, 456)
    }),
    "wall-slides": `${h({
      head: p(472, 174), shoulder: p(488, 264), hip: p(496, 408),
      leftElbow: p(410, 220), leftHand: p(386, 132),
      rightElbow: p(566, 220), rightHand: p(590, 132),
      leftKnee: p(444, 484), leftFoot: p(420, 560),
      rightKnee: p(540, 484), rightFoot: p(564, 560)
    })}${guide("M370 364 L370 172", warm)}${guide("M606 364 L606 172", warm)}`,
    "floor-angels": `${h({
      head: p(480, 430), shoulder: p(480, 388), hip: p(480, 410),
      leftElbow: p(350, 332), leftHand: p(250, 280),
      rightElbow: p(610, 332), rightHand: p(710, 280),
      leftKnee: p(420, 470), leftFoot: p(360, 500),
      rightKnee: p(540, 470), rightFoot: p(600, 500)
    })}${guide("M250 260 C326 170 420 150 480 190", warm)}${guide("M710 260 C634 170 540 150 480 190", warm)}`,
    "snow-angels": `${h({
      head: p(480, 430), shoulder: p(480, 388), hip: p(480, 410),
      leftElbow: p(350, 332), leftHand: p(250, 280),
      rightElbow: p(610, 332), rightHand: p(710, 280),
      leftKnee: p(400, 470), leftFoot: p(310, 500),
      rightKnee: p(560, 470), rightFoot: p(650, 500)
    })}${guide("M250 270 C300 180 390 150 464 184", warm)}${guide("M710 270 C660 180 570 150 496 184", warm)}`,
    "back-widow": h({
      head: p(250, 430), shoulder: p(350, 430), hip: p(510, 440),
      leftElbow: p(302, 370), leftHand: p(230, 334),
      rightElbow: p(390, 368), rightHand: p(468, 330),
      leftKnee: p(626, 440), leftFoot: p(742, 456),
      rightKnee: p(650, 454), rightFoot: p(812, 464)
    }),
    "back-widow-bent": h({
      head: p(250, 430), shoulder: p(350, 430), hip: p(500, 438),
      leftElbow: p(304, 370), leftHand: p(230, 334),
      rightElbow: p(394, 370), rightHand: p(468, 334),
      leftKnee: p(596, 374), leftFoot: p(682, 456),
      rightKnee: p(660, 378), rightFoot: p(790, 456)
    }),
    "lat-squeeze": `${h({ ...stand, leftElbow: p(382, 316), leftHand: p(340, 392), rightElbow: p(576, 316), rightHand: p(620, 392) })}${guide("M338 288 C386 242 438 232 478 256", warm)}${guide("M622 288 C574 242 522 232 482 256", warm)}`,
    "prone-t": h({
      head: p(256, 430), shoulder: p(348, 430), hip: p(580, 434),
      leftElbow: p(348, 330), leftHand: p(348, 240),
      rightElbow: p(348, 530), rightHand: p(348, 580),
      leftKnee: p(678, 430), leftFoot: p(814, 430),
      rightKnee: p(680, 448), rightFoot: p(812, 464)
    }),
    "prone-w": h({
      head: p(256, 430), shoulder: p(348, 430), hip: p(580, 434),
      leftElbow: p(392, 352), leftHand: p(320, 298),
      rightElbow: p(392, 508), rightHand: p(320, 562),
      leftKnee: p(678, 430), leftFoot: p(814, 430),
      rightKnee: p(680, 448), rightFoot: p(812, 464)
    }),
    "prone-y": h({
      head: p(256, 430), shoulder: p(348, 430), hip: p(580, 434),
      leftElbow: p(404, 320), leftHand: p(486, 220),
      rightElbow: p(404, 536), rightHand: p(486, 594),
      leftKnee: p(678, 430), leftFoot: p(814, 430),
      rightKnee: p(680, 448), rightFoot: p(812, 464)
    }),
    "prone-alternate": `${h({
      head: p(256, 430), shoulder: p(348, 430), hip: p(580, 434),
      leftElbow: p(406, 340), leftHand: p(506, 260),
      rightElbow: p(400, 510), rightHand: p(330, 560),
      leftKnee: p(670, 350), leftFoot: p(780, 270),
      rightKnee: p(680, 462), rightFoot: p(812, 482)
    })}${guide("M508 260 C578 202 662 186 742 212", warm)}`,
    child: h({
      head: p(310, 430), shoulder: p(398, 434), hip: p(574, 404),
      leftElbow: p(360, 492), leftHand: p(280, 520),
      rightElbow: p(440, 492), rightHand: p(360, 520),
      leftKnee: p(520, 470), leftFoot: p(640, 500),
      rightKnee: p(604, 470), rightFoot: p(746, 500)
    }),
    butterfly: h({
      head: p(480, 210), shoulder: p(480, 292), hip: p(480, 410),
      leftElbow: p(414, 346), leftHand: p(350, 410),
      rightElbow: p(546, 346), rightHand: p(610, 410),
      leftKnee: p(374, 470), leftFoot: p(466, 450),
      rightKnee: p(586, 470), rightFoot: p(494, 450)
    }),
    "seated-90": h({
      head: p(472, 220), shoulder: p(472, 306), hip: p(470, 414),
      leftElbow: p(410, 356), leftHand: p(342, 404),
      rightElbow: p(532, 356), rightHand: p(602, 404),
      leftKnee: p(360, 458), leftFoot: p(244, 456),
      rightKnee: p(586, 458), rightFoot: p(712, 456)
    }),
    "seated-hamstring": h({
      head: p(410, 216), shoulder: p(438, 300), hip: p(476, 420),
      leftElbow: p(470, 356), leftHand: p(552, 420),
      rightElbow: p(480, 366), rightHand: p(638, 444),
      leftKnee: p(624, 448), leftFoot: p(792, 448),
      rightKnee: p(396, 470), rightFoot: p(286, 508)
    }),
    "active-hamstring": `${h({
      head: p(404, 196), shoulder: p(434, 288), hip: p(492, 408),
      leftElbow: p(434, 344), leftHand: p(390, 428),
      rightElbow: p(500, 344), rightHand: p(612, 438),
      leftKnee: p(420, 482), leftFoot: p(370, 560),
      rightKnee: p(630, 448), rightFoot: p(800, 448)
    })}${guide("M684 402 C740 378 794 388 832 430", warm)}`,
    "lat-stretch": h({
      head: p(480, 188), shoulder: p(480, 272), hip: p(484, 410),
      leftElbow: p(414, 170), leftHand: p(374, 106),
      rightElbow: p(546, 170), rightHand: p(592, 106),
      leftKnee: p(430, 486), leftFoot: p(378, 560),
      rightKnee: p(538, 486), rightFoot: p(596, 560)
    }),
    "cross-shoulder": h({
      head: p(480, 178), shoulder: p(480, 266), hip: p(480, 410),
      leftElbow: p(560, 270), leftHand: p(690, 262),
      rightElbow: p(456, 314), rightHand: p(370, 292),
      leftKnee: p(430, 486), leftFoot: p(388, 560),
      rightKnee: p(532, 486), rightFoot: p(572, 560)
    }),
    "knees-to-chest": h({
      head: p(248, 426), shoulder: p(340, 420), hip: p(468, 434),
      leftElbow: p(414, 368), leftHand: p(500, 318),
      rightElbow: p(438, 464), rightHand: p(542, 468),
      leftKnee: p(548, 330), leftFoot: p(664, 302),
      rightKnee: p(568, 456), rightFoot: p(704, 480)
    }),
    "spinal-twist": h({
      head: p(256, 424), shoulder: p(344, 418), hip: p(464, 434),
      leftElbow: p(310, 364), leftHand: p(244, 332),
      rightElbow: p(400, 366), rightHand: p(500, 332),
      leftKnee: p(558, 366), leftFoot: p(680, 332),
      rightKnee: p(580, 468), rightFoot: p(740, 490)
    }),
    cobra: h({
      head: p(286, 248), shoulder: p(346, 324), hip: p(580, 420),
      leftElbow: p(330, 444), leftHand: p(306, 522),
      rightElbow: p(420, 456), rightHand: p(396, 532),
      leftKnee: p(682, 430), leftFoot: p(812, 448),
      rightKnee: p(682, 452), rightFoot: p(812, 478)
    }),
    stretch: h({
      head: p(468, 216), shoulder: p(468, 300), hip: p(466, 420),
      leftElbow: p(392, 350), leftHand: p(324, 410),
      rightElbow: p(544, 350), rightHand: p(616, 410),
      leftKnee: p(388, 482), leftFoot: p(278, 500),
      rightKnee: p(560, 480), rightFoot: p(670, 500)
    })
  };

  return poses[pose] || poses.standing;
}

function svgFor(exercise) {
  const [bg, accent, warm] = palettes[exercise.category] || palettes["Full body"];
  const pose = poseFor(exercise.name, exercise.category);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600" role="img" aria-labelledby="title desc">
  <title id="title">${esc(exercise.name)}</title>
  <desc id="desc">Illustrazione originale dell'esercizio ${esc(exercise.name)}, ottimizzata per display ad alta densita.</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 Z" fill="${warm}"/>
    </marker>
  </defs>
  <rect width="960" height="600" rx="56" fill="${bg}"/>
  <circle cx="156" cy="476" r="138" fill="#fff" opacity=".36"/>
  ${context(pose, accent, warm)}
  ${art(pose, accent, warm)}
  <rect x="34" y="30" width="386" height="58" rx="29" fill="#fff" opacity=".88"/>
  <text x="62" y="68" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="850" fill="${accent}">${esc(shortLabel(exercise.name))}</text>
</svg>
`;
}

fs.mkdirSync(outDir, { recursive: true });

data.exercises = data.exercises.map((exercise) => {
  const filename = filenameFromImage(exercise.image);
  fs.writeFileSync(path.join(outDir, filename), svgFor(exercise));
  return { ...exercise, image: `assets/exercises/${filename}` };
});

fs.writeFileSync(libraryPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Generated ${data.exercises.length} high-detail SVG exercise illustrations.`);
