const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");
const outDir = path.join(root, "web-dist");

function copyRecursive(source, destination) {
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}

copyRecursive(srcDir, outDir);

// Inject Supabase configuration into the browser build.
const indexPath = path.join(outDir, "index.html");

let html = fs.readFileSync(indexPath, "utf8");

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabasePublishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || "";

const configScript = `
<script>
window.__ANDA_CONFIG__ = {
  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},
  SUPABASE_PUBLISHABLE_KEY: ${JSON.stringify(supabasePublishableKey)}
};
</script>
`;

html = html.replace("</head>", `${configScript}</head>`);

fs.writeFileSync(indexPath, html, "utf8");

console.log("Anda Vyapar web build created successfully.");
console.log(`Output: ${outDir}`);

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn(
    "Warning: Supabase environment variables are not set. " +
    "The web build will run in local-only mode."
  );
}
