/**
 * TableSomm frontend entrypoint
 *
 * Complete single-file browser app for restaurant menu management, wine pairing,
 * PDF/image menu parsing, manager-controlled branding, shellfish/raw-bar category
 * support, and UI synchronization.
 */

const MENU_PARSER_API_BASE = "https://tablesomm-menu-parser-api.onrender.com";
const STORAGE_KEY = "tablesomm.state.v2";

type ServiceStyle = "by-the-glass" | "bottle" | "pairing" | "special";
type Intensity = "light" | "medium" | "rich";

interface Dish {
  id: string;
  name: string;
  section: string;
  description: string;
  price?: number;
  ingredients: string[];
  tags: string[];
  intensity: Intensity;
  pairing: string;
  pairingNotes: string;
  wineStyle: string;
  serviceStyle: ServiceStyle;
  rawBar?: boolean;
  shellfish?: boolean;
  seasonal?: boolean;
  updatedAt: string;
}

interface Branding {
  name: string;
  subtitle: string;
  logo: string;
  accentColor: string;
}

interface ImportMeta {
  lastImportedAt?: string;
  lastDishCount?: number;
  lastSections?: string[];
  lastParserVersion?: string;
}

interface AppState {
  branding: Branding;
  dishes: Dish[];
  selectedDishId?: string;
  query: string;
  sectionFilter: string;
  status: string;
  importMeta: ImportMeta;
}

const DEFAULT_LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#7c2d12"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="22" fill="url(#g)"/>
  <path d="M33 24h30v7H52v39h-8V31H33z" fill="#fff8ed"/>
  <path d="M29 70h38v6H29z" fill="#fbbf24"/>
</svg>`);

const DEFAULT_STATE: AppState = {
  branding: {
    name: "TableSomm",
    subtitle: "Restaurant wine-pairing assistant",
    logo: DEFAULT_LOGO,
    accentColor: "#7c2d12",
  },
  dishes: [
    normalizeDish({
      name: "Oysters on the Half Shell",
      section: "Raw Bar",
      description: "Fresh oysters served chilled with mignonette and lemon.",
      price: 24,
      ingredients: ["oysters", "mignonette", "lemon"],
      tags: ["shellfish", "raw bar", "briny", "chilled"],
      pairing: "Muscadet",
      pairingNotes:
        "High acidity and saline minerality match the briny shellfish without overpowering it.",
      wineStyle: "Crisp coastal white",
      serviceStyle: "by-the-glass",
      intensity: "light",
    }),
    normalizeDish({
      name: "Roasted Chicken",
      section: "Entrees",
      description: "Herb roasted chicken with seasonal vegetables and pan jus.",
      price: 32,
      ingredients: ["chicken", "herbs", "vegetables", "pan jus"],
      tags: ["poultry", "savory", "comfort"],
      pairing: "Pinot Noir",
      pairingNotes:
        "Red-fruited Pinot Noir complements roasted herbs while staying light enough for poultry.",
      wineStyle: "Light-bodied red",
      serviceStyle: "by-the-glass",
      intensity: "medium",
    }),
  ],
  selectedDishId: undefined,
  query: "",
  sectionFilter: "All",
  status: "Ready.",
  importMeta: {},
};

let state: AppState = loadState();

function loadState(): AppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      branding: { ...DEFAULT_STATE.branding, ...(parsed.branding ?? {}) },
      importMeta: { ...(parsed.importMeta ?? {}) },
      dishes: Array.isArray(parsed.dishes)
        ? parsed.dishes.map((dish: unknown) => normalizeDish(dish))
        : structuredClone(DEFAULT_STATE.dishes),
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeDish(input: any): Dish {
  const rawName = String(input?.name ?? input?.dish ?? input?.title ?? "Untitled dish").trim();
  const rawSection = String(
    input?.section ?? input?.category ?? input?.menuSection ?? input?.course ?? "Menu"
  ).trim();
  const rawDescription = String(input?.description ?? input?.desc ?? input?.notes ?? "").trim();
  const ingredients = normalizeList(input?.ingredients);
  const tags = normalizeList(input?.tags);
  const sectionTags = deriveTags(rawName, rawSection, rawDescription, ingredients, tags);

  const mergedTags = unique([...tags, ...sectionTags]);
  const rawBar = isRawBarDish(rawName, rawSection, rawDescription, mergedTags);
  const shellfish = isShellfishDish(rawName, rawSection, rawDescription, ingredients, mergedTags);

  const pairing = String(input?.pairing ?? input?.winePairing ?? "").trim();
  const pairingNotes = String(input?.pairingNotes ?? input?.pairing_notes ?? "").trim();

  return {
    id: String(input?.id ?? slugify(`${rawSection}-${rawName}-${Date.now()}-${Math.random()}`)),
    name: rawName,
    section: rawSection || "Menu",
    description: rawDescription,
    price: normalizePrice(input?.price),
    ingredients,
    tags: unique([
      ...mergedTags,
      ...(rawBar ? ["raw bar"] : []),
      ...(shellfish ? ["shellfish"] : []),
    ]),
    intensity: normalizeIntensity(input?.intensity, rawDescription, rawBar, shellfish),
    pairing: pairing || recommendPairing(rawName, rawSection, rawDescription, ingredients, mergedTags),
    pairingNotes:
      pairingNotes ||
      recommendPairingNotes(rawName, rawSection, rawDescription, ingredients, mergedTags),
    wineStyle:
      String(input?.wineStyle ?? input?.wine_style ?? "").trim() ||
      recommendWineStyle(rawName, rawSection, rawDescription, ingredients, mergedTags),
    serviceStyle: normalizeServiceStyle(input?.serviceStyle ?? input?.service_style),
    rawBar,
    shellfish,
    seasonal: Boolean(input?.seasonal ?? mergedTags.includes("seasonal")),
    updatedAt: String(input?.updatedAt ?? new Date().toISOString()),
  };
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map((x) => String(x).trim()).filter(Boolean));
  if (typeof value === "string") {
    return unique(
      value
        .split(/[|,;]+/)
        .map((x) => x.trim())
        .filter(Boolean)
    );
  }
  return [];
}

function normalizePrice(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function normalizeIntensity(
  value: unknown,
  description: string,
  rawBar: boolean,
  shellfish: boolean
): Intensity {
  const v = String(value ?? "").toLowerCase();
  if (v === "light" || v === "medium" || v === "rich") return v;
  const text = description.toLowerCase();
  if (rawBar || shellfish || /salad|crudo|ceviche|sushi|bright|citrus/.test(text)) return "light";
  if (/braised|steak|short rib|lamb|cream|butter|truffle|mushroom/.test(text)) return "rich";
  return "medium";
}

function normalizeServiceStyle(value: unknown): ServiceStyle {
  const v = String(value ?? "").toLowerCase();
  if (v === "bottle" || v === "pairing" || v === "special") return v;
  return "by-the-glass";
}

function deriveTags(
  name: string,
  section: string,
  description: string,
  ingredients: string[],
  existingTags: string[]
): string[] {
  const text = [name, section, description, ingredients.join(" "), existingTags.join(" ")]
    .join(" ")
    .toLowerCase();
  const tags: string[] = [];

  if (/raw bar|shellfish tower|seafood tower|oyster|clam|shrimp cocktail|crab|lobster|prawn|ceviche|crudo|sashimi|sushi/.test(text)) {
    tags.push("raw bar");
  }
  if (/oyster|clam|mussel|shrimp|prawn|crab|lobster|scallop|shellfish/.test(text)) {
    tags.push("shellfish");
  }
  if (/sushi|sashimi|nigiri|maki|roll/.test(text)) tags.push("sushi");
  if (/steak|beef|ribeye|filet|short rib/.test(text)) tags.push("beef");
  if (/chicken|duck|turkey|poultry/.test(text)) tags.push("poultry");
  if (/pork|prosciutto|bacon|ham/.test(text)) tags.push("pork");
  if (/salmon|tuna|halibut|cod|branzino|fish/.test(text)) tags.push("fish");
  if (/vegan|vegetarian|mushroom|squash|eggplant|cauliflower/.test(text)) tags.push("vegetable");
  if (/spicy|chile|chili|harissa|jalapeño|jalapeno/.test(text)) tags.push("spicy");
  if (/seasonal|market|daily/.test(text)) tags.push("seasonal");

  return tags;
}

function isRawBarDish(
  name: string,
  section: string,
  description: string,
  tags: string[]
): boolean {
  const text = [name, section, description, tags.join(" ")].join(" ").toLowerCase();
  return /raw bar|shellfish tower|seafood tower|oyster|clam|shrimp cocktail|ceviche|crudo|sashimi|sushi/.test(
    text
  );
}

function isShellfishDish(
  name: string,
  section: string,
  description: string,
  ingredients: string[],
  tags: string[]
): boolean {
  const text = [name, section, description, ingredients.join(" "), tags.join(" ")]
    .join(" ")
    .toLowerCase();
  return /shellfish|oyster|clam|mussel|shrimp|prawn|crab|lobster|scallop/.test(text);
}

function recommendPairing(
  name: string,
  section: string,
  description: string,
  ingredients: string[],
  tags: string[]
): string {
  const text = [name, section, description, ingredients.join(" "), tags.join(" ")]
    .join(" ")
    .toLowerCase();

  if (/oyster|clam|raw bar|shellfish tower/.test(text)) return "Muscadet";
  if (/shrimp|prawn|crab|lobster|scallop/.test(text)) return "Chablis";
  if (/sushi|sashimi|nigiri|maki|crudo|ceviche/.test(text)) return "Dry Riesling";
  if (/spicy|chile|chili|harissa|jalapeño|jalapeno/.test(text)) return "Off-dry Riesling";
  if (/salmon|tuna|duck|mushroom/.test(text)) return "Pinot Noir";
  if (/steak|ribeye|filet|short rib|lamb/.test(text)) return "Cabernet Sauvignon";
  if (/pork|ham|prosciutto/.test(text)) return "Grenache";
  if (/salad|goat cheese|vegetable|vegetarian/.test(text)) return "Sauvignon Blanc";
  if (/cream|butter|truffle/.test(text)) return "White Burgundy";
  return "Sommelier's seasonal pairing";
}

function recommendPairingNotes(
  name: string,
  section: string,
  description: string,
  ingredients: string[],
  tags: string[]
): string {
  const text = [name, section, description, ingredients.join(" "), tags.join(" ")]
    .join(" ")
    .toLowerCase();

  if (/oyster|clam|raw bar|shellfish tower/.test(text)) {
    return "A crisp, saline white keeps the pairing bright and reinforces the ocean-mineral character.";
  }
  if (/shrimp|prawn|crab|lobster|scallop/.test(text)) {
    return "Chablis brings citrus, chalk, and enough texture for sweet shellfish without masking freshness.";
  }
  if (/sushi|sashimi|nigiri|maki|crudo|ceviche/.test(text)) {
    return "Dry Riesling adds lift, precision, and citrus aromatics that work with raw seafood preparations.";
  }
  if (/spicy|chile|chili|harissa|jalapeño|jalapeno/.test(text)) {
    return "A touch of residual sugar and high acidity cools heat while keeping the dish energetic.";
  }
  if (/steak|ribeye|filet|short rib|lamb/.test(text)) {
    return "Structured tannins and dark fruit stand up to richer proteins and savory reductions.";
  }
  return "Selected to balance the dish's weight, acidity, and dominant flavor profile.";
}

function recommendWineStyle(
  name: string,
  section: string,
  description: string,
  ingredients: string[],
  tags: string[]
): string {
  const pairing = recommendPairing(name, section, description, ingredients, tags);
  if (/Muscadet|Chablis|Sauvignon|Riesling/.test(pairing)) return "Crisp white";
  if (/Cabernet|Grenache|Pinot/.test(pairing)) return "Food-friendly red";
  if (/Burgundy/.test(pairing)) return "Textured white";
  return "Seasonal sommelier selection";
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((x) => x.trim()).filter(Boolean)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function money(value?: number): string {
  return typeof value === "number" ? `$${value.toFixed(value % 1 ? 2 : 0)}` : "";
}

function sections(): string[] {
  return ["All", ...unique(state.dishes.map((dish) => dish.section)).sort()];
}

function filteredDishes(): Dish[] {
  const q = state.query.trim().toLowerCase();
  return state.dishes.filter((dish) => {
    const sectionOk = state.sectionFilter === "All" || dish.section === state.sectionFilter;
    const queryOk =
      !q ||
      [dish.name, dish.section, dish.description, dish.pairing, dish.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return sectionOk && queryOk;
  });
}

function buildShell(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) return;

  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-block">
          <img class="brand-logo" data-brand-logo alt="Restaurant logo" />
          <div>
            <div class="brand-title" data-brand-name></div>
            <div class="brand-subtitle" data-brand-subtitle></div>
          </div>
        </div>
        <nav class="nav-stack">
          <button class="nav-item active" type="button">Menu Manager</button>
          <button class="nav-item" type="button">Pairing Notes</button>
          <button class="nav-item" type="button">Settings</button>
        </nav>
        <div class="sidebar-footer">
          <span class="pill good">AI parser enabled</span>
          <span class="pill">PDF & image import</span>
        </div>
      </aside>

      <main class="main-panel">
        <header class="mobile-header">
          <img class="mobile-logo" data-brand-logo alt="Restaurant logo" />
          <div data-brand-name></div>
        </header>

        <section class="hero-card">
          <div>
            <img class="hero-logo" data-brand-logo alt="Restaurant logo" />
          </div>
          <div>
            <p class="eyebrow">TableSomm</p>
            <h1 data-page-title></h1>
            <p class="muted" data-brand-subtitle></p>
          </div>
        </section>

        <section class="grid two">
          <div class="card">
            <div class="card-title-row">
              <div>
                <h3>Meal Menu Import</h3>
                <p class="muted">Upload dishes in JSON, CSV, PDF, or image format, or maintain them manually for seasonal menu changes.</p>
              </div>
            </div>
            <div class="upload-row">
              <input id="menu-file" type="file" accept=".json,.csv,.pdf,image/*,application/json,text/csv" />
              <button id="sample-data" type="button">Load sample</button>
            </div>
            <p class="status" id="import-status"></p>
          </div>

          <div class="card">
            <h3>Brand Settings</h3>
            <label>
              Restaurant name
              <input id="branding-name" type="text" data-branding-name />
            </label>
            <label>
              Subtitle
              <input id="branding-subtitle" type="text" data-branding-subtitle />
            </label>
            <label>
              Logo
              <input id="branding-logo" type="file" accept="image/*" />
            </label>
          </div>
        </section>

        <section class="card">
          <div class="toolbar">
            <div>
              <h3>Menu Dishes</h3>
              <p class="muted" id="dish-summary"></p>
            </div>
            <div class="filters">
              <input id="search" type="search" placeholder="Search dishes, tags, pairings..." />
              <select id="section-filter"></select>
              <button id="add-dish" type="button">Add dish</button>
            </div>
          </div>
          <div id="dish-list" class="dish-list"></div>
        </section>

        <section class="card" id="editor-card">
          <h3>Dish Editor</h3>
          <form id="dish-form" class="dish-form">
            <input type="hidden" id="dish-id" />
            <label>Name<input id="dish-name" required /></label>
            <label>Section<input id="dish-section" required /></label>
            <label>Description<textarea id="dish-description" rows="3"></textarea></label>
            <label>Price<input id="dish-price" inputmode="decimal" /></label>
            <label>Ingredients<input id="dish-ingredients" placeholder="comma-separated" /></label>
            <label>Tags<input id="dish-tags" placeholder="comma-separated" /></label>
            <label>Pairing<input id="dish-pairing" /></label>
            <label>Pairing notes<textarea id="dish-pairing-notes" rows="3"></textarea></label>
            <div class="form-actions">
              <button type="submit">Save dish</button>
              <button type="button" id="delete-dish" class="danger">Delete</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  `;

  injectStyles();
}

function injectStyles(): void {
  if (document.querySelector("#tablesomm-styles")) return;
  const style = document.createElement("style");
  style.id = "tablesomm-styles";
  style.textContent = `
    :root { --accent: ${state.branding.accentColor}; --ink: #111827; --muted: #6b7280; --line: #e5e7eb; --card: #fff; --bg: #f7f3ee; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
    button, input, textarea, select { font: inherit; }
    button { border: 0; border-radius: 12px; background: var(--accent); color: #fff; padding: 10px 14px; cursor: pointer; font-weight: 700; }
    button.secondary, .nav-item { background: transparent; color: var(--ink); }
    button.danger { background: #991b1b; }
    input, textarea, select { width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: #fff; }
    label { display: grid; gap: 6px; font-size: 13px; font-weight: 700; color: #374151; }
    h1, h3, p { margin-top: 0; }
    .app-shell { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
    .sidebar { background: #fffaf3; border-right: 1px solid var(--line); padding: 24px; display: flex; flex-direction: column; gap: 24px; }
    .brand-block, .mobile-header, .hero-card, .card-title-row, .toolbar, .upload-row, .filters, .form-actions { display: flex; align-items: center; gap: 14px; }
    .brand-logo, .mobile-logo { width: 48px; height: 48px; border-radius: 14px; object-fit: cover; }
    .hero-logo { width: 72px; height: 72px; border-radius: 20px; object-fit: cover; }
    .brand-title { font-weight: 900; font-size: 18px; }
    .brand-subtitle, .muted { color: var(--muted); }
    .nav-stack { display: grid; gap: 8px; }
    .nav-item { text-align: left; }
    .nav-item.active { background: #ffedd5; color: #7c2d12; }
    .sidebar-footer { margin-top: auto; display: flex; flex-wrap: wrap; gap: 8px; }
    .pill { display: inline-flex; width: fit-content; border: 1px solid var(--line); border-radius: 999px; padding: 5px 9px; font-size: 12px; color: #374151; background: #fff; }
    .pill.good { border-color: #86efac; color: #166534; background: #f0fdf4; }
    .main-panel { padding: 28px; display: grid; gap: 20px; align-content: start; }
    .mobile-header { display: none; }
    .hero-card, .card { background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 22px; box-shadow: 0 16px 40px rgba(17, 24, 39, 0.06); }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px; }
    .grid.two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .toolbar { justify-content: space-between; align-items: flex-start; }
    .filters { min-width: min(560px, 100%); }
    .dish-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-top: 18px; }
    .dish-card { border: 1px solid var(--line); border-radius: 18px; padding: 16px; background: #fff; display: grid; gap: 10px; cursor: pointer; }
    .dish-card.selected { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
    .dish-title-row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .dish-name { font-weight: 900; }
    .dish-section { color: var(--muted); font-size: 13px; }
    .tag-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { background: #f3f4f6; color: #374151; border-radius: 999px; padding: 4px 8px; font-size: 12px; }
    .tag.raw { background: #ecfeff; color: #155e75; }
    .pairing { border-left: 3px solid var(--accent); padding-left: 10px; }
    .dish-form { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .dish-form label:nth-child(4), .dish-form label:nth-child(9), .form-actions { grid-column: 1 / -1; }
    .status { margin-bottom: 0; color: var(--muted); }
    @media (max-width: 920px) {
      .app-shell, .grid.two, .dish-form { grid-template-columns: 1fr; }
      .sidebar { display: none; }
      .mobile-header { display: flex; }
      .toolbar, .filters, .upload-row { align-items: stretch; flex-direction: column; }
    }
  `;
  document.head.appendChild(style);
}

function bindEvents(): void {
  document.querySelector("#menu-file")?.addEventListener("change", handleMenuFileChange);
  document.querySelector("#sample-data")?.addEventListener("click", () => {
    state.dishes = structuredClone(DEFAULT_STATE.dishes).map((dish) => normalizeDish(dish));
    state.status = `Loaded ${state.dishes.length} sample dishes.`;
    saveState();
    render();
  });

  document.querySelector("#branding-name")?.addEventListener("input", (event) => {
    state.branding.name = (event.target as HTMLInputElement).value;
    saveState();
    syncBranding();
  });

  document.querySelector("#branding-subtitle")?.addEventListener("input", (event) => {
    state.branding.subtitle = (event.target as HTMLInputElement).value;
    saveState();
    syncBranding();
  });

  document.querySelector("#branding-logo")?.addEventListener("change", handleLogoChange);

  document.querySelector("#search")?.addEventListener("input", (event) => {
    state.query = (event.target as HTMLInputElement).value;
    renderDishList();
  });

  document.querySelector("#section-filter")?.addEventListener("change", (event) => {
    state.sectionFilter = (event.target as HTMLSelectElement).value;
    renderDishList();
  });

  document.querySelector("#add-dish")?.addEventListener("click", () => {
    state.selectedDishId = undefined;
    fillDishForm();
  });

  document.querySelector("#dish-form")?.addEventListener("submit", handleDishSubmit);
  document.querySelector("#delete-dish")?.addEventListener("click", handleDishDelete);
}

async function handleMenuFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    state.status = `Importing ${file.name}...`;
    renderStatus();

    const result = await parseMenuFile(file);
    const dishes = Array.isArray(result.dishes) ? result.dishes : [];
    state.dishes = dishes.map((x: any) => normalizeDish(x));
    state.importMeta = {
      lastImportedAt: new Date().toISOString(),
      lastDishCount: state.dishes.length,
      lastSections: Array.isArray(result.sections) ? result.sections.map(String) : undefined,
      lastParserVersion:
        typeof result.parserVersion === "string" ? result.parserVersion : undefined,
    };

    const sectionsText =
      state.importMeta.lastSections && state.importMeta.lastSections.length
        ? ` Sections: ${state.importMeta.lastSections.join(", ")}.`
        : "";
    const versionText = state.importMeta.lastParserVersion
      ? ` Parser: ${state.importMeta.lastParserVersion}.`
      : "";
    state.status = `Imported ${state.dishes.length} dishes from ${file.name}.${sectionsText}${versionText}`;
    saveState();
    render();
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Unable to import menu.";
    renderStatus();
  } finally {
    input.value = "";
  }
}

async function parseMenuFile(file: File): Promise<{
  dishes: unknown[];
  sections?: string[];
  parserVersion?: string;
}> {
  const type = file.type;
  const name = file.name.toLowerCase();

  if (type === "application/json" || name.endsWith(".json")) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return { dishes: Array.isArray(parsed) ? parsed : parsed.dishes ?? [], sections: parsed.sections };
  }

  if (type === "text/csv" || name.endsWith(".csv")) {
    const text = await file.text();
    return { dishes: csv(text) };
  }

  if (type === "application/pdf" || name.endsWith(".pdf") || type.startsWith("image/")) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${MENU_PARSER_API_BASE}/parse-menu`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Menu parser failed with status ${response.status}.`);
    }

    const payload = await response.json();
    const dishes = Array.isArray(payload.dishes) ? payload.dishes : [];
    return {
      dishes,
      sections: Array.isArray(payload.sections) ? payload.sections : undefined,
      parserVersion:
        typeof payload.parserVersion === "string" ? payload.parserVersion : undefined,
    };
  }

  throw new Error("Unsupported file type (use JSON, CSV, PDF, or image).");
}

function csv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text.trim());
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) =>
    headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = row[index] ?? "";
      return acc;
    }, {})
  );
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current);
  rows.push(row);
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

function handleLogoChange(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    state.branding.logo = String(reader.result ?? DEFAULT_LOGO);
    saveState();
    syncBranding();
  };
  reader.readAsDataURL(file);
}

function handleDishSubmit(event: Event): void {
  event.preventDefault();
  const id = valueOf("#dish-id");
  const dish = normalizeDish({
    id: id || undefined,
    name: valueOf("#dish-name"),
    section: valueOf("#dish-section"),
    description: valueOf("#dish-description"),
    price: valueOf("#dish-price"),
    ingredients: valueOf("#dish-ingredients"),
    tags: valueOf("#dish-tags"),
    pairing: valueOf("#dish-pairing"),
    pairingNotes: valueOf("#dish-pairing-notes"),
  });

  const index = state.dishes.findIndex((x) => x.id === id);
  if (index >= 0) {
    state.dishes[index] = dish;
  } else {
    state.dishes.unshift(dish);
  }

  state.selectedDishId = dish.id;
  state.status = `Saved ${dish.name}.`;
  saveState();
  render();
}

function handleDishDelete(): void {
  const id = valueOf("#dish-id");
  if (!id) return;
  const dish = state.dishes.find((x) => x.id === id);
  state.dishes = state.dishes.filter((x) => x.id !== id);
  state.selectedDishId = undefined;
  state.status = dish ? `Deleted ${dish.name}.` : "Dish deleted.";
  saveState();
  render();
}

function valueOf(selector: string): string {
  return (document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value ?? "").trim();
}

function render(): void {
  syncBranding();
  renderControls();
  renderStatus();
  renderDishList();
  fillDishForm();
}

function syncBranding(): void {
  document.documentElement.style.setProperty("--accent", state.branding.accentColor);
  document.title = `${state.branding.name} | TableSomm`;

  document.querySelectorAll<HTMLElement>("[data-brand-name]").forEach((el) => {
    el.textContent = state.branding.name;
  });
  document.querySelectorAll<HTMLElement>("[data-brand-subtitle]").forEach((el) => {
    el.textContent = state.branding.subtitle;
  });
  document.querySelectorAll<HTMLImageElement>("[data-brand-logo]").forEach((img) => {
    img.src = state.branding.logo || DEFAULT_LOGO;
    img.alt = `${state.branding.name} logo`;
  });
  document.querySelectorAll<HTMLElement>("[data-page-title]").forEach((el) => {
    el.textContent = `${state.branding.name} menu pairing workspace`;
  });

  const nameInput = document.querySelector<HTMLInputElement>("[data-branding-name]");
  if (nameInput && nameInput.value !== state.branding.name) nameInput.value = state.branding.name;

  const subtitleInput = document.querySelector<HTMLInputElement>("[data-branding-subtitle]");
  if (subtitleInput && subtitleInput.value !== state.branding.subtitle) {
    subtitleInput.value = state.branding.subtitle;
  }
}

function renderControls(): void {
  const search = document.querySelector<HTMLInputElement>("#search");
  if (search && search.value !== state.query) search.value = state.query;

  const select = document.querySelector<HTMLSelectElement>("#section-filter");
  if (select) {
    const currentSections = sections();
    select.innerHTML = currentSections
      .map((section) => `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`)
      .join("");
    select.value = currentSections.includes(state.sectionFilter) ? state.sectionFilter : "All";
    state.sectionFilter = select.value;
  }

  const summary = document.querySelector("#dish-summary");
  if (summary) {
    const shellfishCount = state.dishes.filter((dish) => dish.shellfish).length;
    const rawBarCount = state.dishes.filter((dish) => dish.rawBar).length;
    summary.textContent = `${state.dishes.length} dishes across ${Math.max(sections().length - 1, 0)} sections. ${rawBarCount} raw bar and ${shellfishCount} shellfish-aware dishes.`;
  }
}

function renderStatus(): void {
  const status = document.querySelector("#import-status");
  if (status) status.textContent = state.status;
}

function renderDishList(): void {
  const list = document.querySelector("#dish-list");
  if (!list) return;

  const dishes = filteredDishes();
  if (!dishes.length) {
    list.innerHTML = `<div class="muted">No dishes match the current filters.</div>`;
    return;
  }

  list.innerHTML = dishes
    .map(
      (dish) => `
      <article class="dish-card ${dish.id === state.selectedDishId ? "selected" : ""}" data-dish-id="${escapeHtml(dish.id)}">
        <div class="dish-title-row">
          <div>
            <div class="dish-name">${escapeHtml(dish.name)}</div>
            <div class="dish-section">${escapeHtml(dish.section)}</div>
          </div>
          <strong>${escapeHtml(money(dish.price))}</strong>
        </div>
        <p class="muted">${escapeHtml(dish.description || "No description yet.")}</p>
        <div class="tag-row">
          ${dish.tags
            .slice(0, 6)
            .map(
              (tag) =>
                `<span class="tag ${tag === "raw bar" || tag === "shellfish" ? "raw" : ""}">${escapeHtml(tag)}</span>`
            )
            .join("")}
        </div>
        <div class="pairing">
          <strong>${escapeHtml(dish.pairing)}</strong>
          <div class="muted">${escapeHtml(dish.pairingNotes)}</div>
        </div>
      </article>`
    )
    .join("");

  list.querySelectorAll<HTMLElement>("[data-dish-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedDishId = card.dataset.dishId;
      fillDishForm();
      renderDishList();
      saveState();
    });
  });
}

function fillDishForm(): void {
  const dish = state.dishes.find((x) => x.id === state.selectedDishId);
  setValue("#dish-id", dish?.id ?? "");
  setValue("#dish-name", dish?.name ?? "");
  setValue("#dish-section", dish?.section ?? "");
  setValue("#dish-description", dish?.description ?? "");
  setValue("#dish-price", dish?.price?.toString() ?? "");
  setValue("#dish-ingredients", dish?.ingredients.join(", ") ?? "");
  setValue("#dish-tags", dish?.tags.join(", ") ?? "");
  setValue("#dish-pairing", dish?.pairing ?? "");
  setValue("#dish-pairing-notes", dish?.pairingNotes ?? "");
}

function setValue(selector: string, value: string): void {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (el && el.value !== value) el.value = value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function init(): void {
  if (!document.querySelector("#app")) {
    const root = document.createElement("div");
    root.id = "app";
    document.body.appendChild(root);
  }

  buildShell();
  bindEvents();
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

export {
  MENU_PARSER_API_BASE,
  csv,
  filteredDishes,
  normalizeDish,
  parseMenuFile,
  render,
  syncBranding,
};
