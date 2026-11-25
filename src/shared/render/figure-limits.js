// A ```figure's size limits, shared by the figure checks (figure.js) and the diagram hints (hints.js). Kept apart from
// figure.js, which needs Intl (absent in the mod runtime), so the Render mod can import the hints without it.
export const FIGURE_MAX_COLUMNS = 100;
export const FIGURE_MAX_LINES = 80;
