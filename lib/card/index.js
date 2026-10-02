// Image cards for Telegram: HTML templates (templates.js) screenshotted into PNG pages (shot.js).
// Each render returns an array of PNG buffers, already cut to Telegram-friendly page heights.
const tpl = require("./templates");
const md = require("./markdown");
const { shoot, findBrowser } = require("./shot");

const available = () => !!findBrowser();

module.exports = {
  available,
  report: (o) => shoot(tpl.reportPage(o)),
  notice: (o) => shoot(tpl.noticePage(o)),
  // App screens are short: one page each.
  screen: async (html) => (await shoot(html, { maxH: 99999 })).slice(0, 1),
  pages: tpl,
  markdown: md,
};
