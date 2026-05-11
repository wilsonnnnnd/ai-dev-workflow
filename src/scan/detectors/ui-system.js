import { exists, findFirstExisting, listDirSafe, readText } from "../fs-utils.js";

const UI_DIRECTORY_PATTERNS = [
    "app",
    "app/pages",
    "app/components",
    "pages",
    "components",
    "components/ui",
    "src/app",
    "src/app/pages",
    "src/app/components",
    "src/pages",
    "src/components",
    "src/components/ui",
    "ui",
    "src/ui",
    "design-system",
    "src/design-system",
    "styles",
    "src/styles",
    "theme",
    "src/theme",
];

const STYLE_CONFIG_FILES = [
    "tailwind.config.js",
    "tailwind.config.ts",
    "postcss.config.js",
    "postcss.config.cjs",
];

const STYLE_FILES = [
    "globals.css",
    "global.css",
    "styles/globals.css",
    "styles/global.css",
    "src/styles/globals.css",
    "src/styles/global.css",
];

const FRAMEWORK_INDICATORS = [
    { pattern: /react|next\.js|nextjs/i, name: "React/Next.js" },
    { pattern: /vue|nuxt/i, name: "Vue/Nuxt" },
    { pattern: /svelte/i, name: "Svelte" },
    { pattern: /angular/i, name: "Angular" },
    { pattern: /solid/i, name: "Solid.js" },
];

const STYLE_SYSTEM_INDICATORS = [
    { pattern: /tailwind/i, name: "Tailwind CSS" },
    { pattern: /styled-components|emotion/i, name: "CSS-in-JS (styled-components/emotion)" },
    { pattern: /sass|scss/i, name: "Sass/SCSS" },
    { pattern: /postcss/i, name: "PostCSS" },
    { pattern: /bootstrap|bulma|foundation/i, name: "CSS Framework" },
];

const COMPONENT_LIBRARY_INDICATORS = [
    { dir: "components/ui", name: "shadcn/ui or internal UI library" },
    { pattern: /@headlessui|@radix-ui|@floating-ui/i, name: "Headless UI library" },
    { pattern: /material-ui|@mui/i, name: "Material-UI" },
    { pattern: /chakra/i, name: "Chakra UI" },
    { pattern: /daisyui/i, name: "Daisy UI" },
];

function detectFramework(packageJson) {
    if (!packageJson) return null;

    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const indicator of FRAMEWORK_INDICATORS) {
        if (Object.keys(deps).some((dep) => indicator.pattern.test(dep))) {
            return indicator.name;
        }
    }
    return null;
}

function detectStyleSystem(packageJson) {
    if (!packageJson) return [];

    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const systems = [];
    for (const indicator of STYLE_SYSTEM_INDICATORS) {
        if (Object.keys(deps).some((dep) => indicator.pattern.test(dep))) {
            systems.push(indicator.name);
        }
    }
    return systems;
}

function detectComponentLibraries(packageJson) {
    if (!packageJson) return [];

    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const libs = [];

    // Check internal UI directories first
    for (const lib of COMPONENT_LIBRARY_INDICATORS) {
        if (lib.dir && exists(lib.dir)) {
            libs.push(lib.name);
            break; // Only report one internal UI lib
        }
    }

    // Check package dependencies
    for (const lib of COMPONENT_LIBRARY_INDICATORS) {
        if (lib.pattern && Object.keys(deps).some((dep) => lib.pattern.test(dep))) {
            libs.push(lib.name);
        }
    }

    return [...new Set(libs)];
}

function detectUIDirectories() {
    const found = [];

    for (const pattern of UI_DIRECTORY_PATTERNS) {
        if (exists(pattern)) {
            found.push(pattern);
        }
    }

    return found;
}

function detectStyleFiles() {
    const found = [];

    for (const file of STYLE_CONFIG_FILES) {
        if (exists(file)) {
            found.push(file);
        }
    }

    for (const file of STYLE_FILES) {
        if (exists(file)) {
            found.push(file);
        }
    }

    return found;
}

function extractComponentNames(directory) {
    if (!exists(directory)) return [];

    const files = listDirSafe(directory);
    const names = [];

    // Extract component names from .tsx, .jsx, .ts, .js files
    const componentFiles = files.filter((f) => /\.(tsx?|jsx?)$/i.test(f));

    for (const file of componentFiles.slice(0, 30)) {
        // Limit to top 30
        const name = file.replace(/\.(tsx?|jsx?)$/, "").replace(/\.test$/, "");
        if (name.toLowerCase() !== "index" && name.toLowerCase() !== "types") {
            names.push(name);
        }
    }

    return names.sort();
}

function detectThemeTokens(packageJson, styleFiles) {
    const tokens = [];

    // Check for theme-related files
    for (const file of styleFiles) {
        if (file.includes("theme") || file.includes("global") || file.includes("globals")) {
            tokens.push("theme variables/tokens");
            break;
        }
    }

    // Check for design token packages
    if (packageJson) {
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        if (Object.keys(deps).some((d) => /tokens|design-tokens|spec/i.test(d))) {
            tokens.push("design token package");
        }
    }

    return [...new Set(tokens)];
}

export function detectUISystem(packageJson) {
    const uiDirs = detectUIDirectories();
    const styleFiles = detectStyleFiles();
    const framework = detectFramework(packageJson);
    const styleSystems = detectStyleSystem(packageJson);
    const componentLibraries = detectComponentLibraries(packageJson);
    const themeTokens = detectThemeTokens(packageJson, styleFiles);

    // Extract components from components/ui or src/components/ui
    const componentDirs = [
        "components/ui",
        "src/components/ui",
        "components",
        "src/components",
    ].filter((d) => exists(d));

    const commonComponents = [];
    for (const dir of componentDirs) {
        const names = extractComponentNames(dir);
        if (names.length > 0) {
            commonComponents.push(...names);
            break; // Use first found directory
        }
    }

    return {
        detected: uiDirs.length > 0 || styleFiles.length > 0,
        framework,
        uiDirectories: uiDirs,
        styleFiles,
        styleSystems,
        componentLibraries,
        commonComponents: [...new Set(commonComponents)].slice(0, 15), // Limit to 15
        themeTokens,
    };
}

export function buildUiDesignContextSummary(uiSystem) {
    if (!uiSystem.detected) {
        return null;
    }

    const parts = [];

    if (uiSystem.framework) {
        parts.push(`Framework: ${uiSystem.framework}`);
    }

    if (uiSystem.styleSystems.length > 0) {
        parts.push(`Styling: ${uiSystem.styleSystems.join(", ")}`);
    }

    if (uiSystem.componentLibraries.length > 0) {
        parts.push(`Components: ${uiSystem.componentLibraries.join(", ")}`);
    }

    if (uiSystem.commonComponents.length > 0) {
        parts.push(`Built components: ${uiSystem.commonComponents.join(", ")}`);
    }

    if (uiSystem.themeTokens.length > 0) {
        parts.push(`Tokens: ${uiSystem.themeTokens.join(", ")}`);
    }

    if (uiSystem.uiDirectories.length > 0) {
        parts.push(`Locations: ${uiSystem.uiDirectories.slice(0, 5).join(", ")}`);
    }

    return parts.join(" | ");
}
