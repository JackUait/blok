import { n as e, r as t, t as n } from "./block-builder-B8WkPORz.mjs";
//#region src/cli/commands/convert-html/index.ts
function r(r) {
	let i = new DOMParser().parseFromString(r, "text/html").body;
	t(i), e(i);
	let a = {
		version: "0.10.0-beta.16",
		blocks: n(i)
	};
	return JSON.stringify(a);
}
//#endregion
export { r as convertHtml };
