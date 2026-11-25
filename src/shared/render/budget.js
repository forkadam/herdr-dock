// How much Markdown the Render panel draws at once, in UTF-8 bytes. Measured with a throwaway mod drawing one coloured
// piece per word: 64 KB (~10,000 pieces) felt fine, 192 KB very laggy, 256 KB was interrupted by Herdr. Its own file
// (no imports) so the mod can use it without pulling in Intl.
export const BUDGET = 64 * 1024;
