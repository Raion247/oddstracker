// Ambient declaration so TypeScript accepts side-effect CSS imports like
// `import "./globals.css"`. Stylesheets have no types of their own, so this
// tells the type checker the module exists. Picked up via tsconfig "include".
declare module "*.css";
