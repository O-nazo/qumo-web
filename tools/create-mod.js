const fs = require("fs");
const path = require("path");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function replaceInFiles(dir, replacers) {
  const exts = new Set([".json", ".js", ".css", ".html", ".md"]);
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      replaceInFiles(p, replacers);
      continue;
    }
    if (!exts.has(path.extname(p))) continue;

    let text = fs.readFileSync(p, "utf8");
    for (const [from, to] of replacers) {
      text = text.split(from).join(to);
    }
    fs.writeFileSync(p, text, "utf8");
  }
}

const id = process.argv[2];
const name = process.argv[3] || id;

if (!id) {
  console.error('Usage: node tools/create-mod.js <modId> "<Mod Name>"');
  process.exit(1);
}

const root = process.cwd();
const templateDir = path.join(root, "mods", "_template");
const outDir = path.join(root, "mods", id);

if (!fs.existsSync(templateDir)) {
  console.error("Template not found:", templateDir);
  process.exit(1);
}
if (fs.existsSync(outDir)) {
  console.error("Already exists:", outDir);
  process.exit(1);
}

copyDir(templateDir, outDir);
replaceInFiles(outDir, [
  ["__MOD_ID__", id],
  ["__MOD_NAME__", name],
]);

console.log("Created MOD:", outDir);
