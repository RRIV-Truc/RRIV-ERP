const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const dest = path.resolve(__dirname, "..", "public");
const files = [
  ["static/css/app-spm-gv.css", "app-spm-gv.css"],
  ["static/js/spm_gv/main.js", "main.js"],
];

fs.mkdirSync(dest, { recursive: true });
for (const [srcRel, name] of files) {
  const src = path.join(root, srcRel);
  fs.copyFileSync(src, path.join(dest, name));
  console.log("copied", srcRel, "->", name);
}
