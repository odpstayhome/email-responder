import fs from "fs/promises";
import Handlebars from "handlebars";

/**
 * Load and compile a Handlebars template from ./src/templates/
 * @param {string} name - template filename without extension (e.g. "STICKER_PAYMENT")
 * @returns {Promise<Function>} - compiled template function
 */
export async function loadTemplate(name) {
  const path = `./src/templates/${name}.hbs`;
  const src = await fs.readFile(path, "utf8");
  return Handlebars.compile(src);
}
