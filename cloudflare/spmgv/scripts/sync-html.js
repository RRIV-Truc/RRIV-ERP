const fs = require("fs");
const path = require("path");
const src = path.resolve(__dirname, "../../../templates/spmgv.html");
const dest = path.resolve(__dirname, "../public/index.html");
let s = fs.readFileSync(src, "utf8");
s = s.replace(/\/static\/css\/app-spm-gv\.css\?v=\d+/, "./app-spm-gv.css");
s = s.replace(/\/static\/js\/spm_gv\/main\.js\?v=\d+/, "./main.js");
if (!s.includes("/config.js")) {
  s = s.replace("</title>", "</title>\n<script src=\"/config.js\"></script>");
}
fs.writeFileSync(dest, s, "utf8");
console.log("wrote public/index.html");
