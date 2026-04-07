import { i as e, n as t, r as n, t as r } from "./block-builder-B8WkPORz.mjs";
//#region src/components/modules/paste/google-docs-preprocessor.ts
function i(e) {
	let t = document.createElement("div");
	t.innerHTML = e;
	let n = a(t);
	return m(t, n), n && g(t), t.innerHTML;
}
function a(e) {
	let t = e.querySelector("b[id^=\"docs-internal-guid-\"]");
	if (!t) return !1;
	let n = document.createDocumentFragment();
	for (; t.firstChild;) n.appendChild(t.firstChild);
	return t.replaceWith(n), !0;
}
function o(e, t, n) {
	return e ? `background-color: ${n}` : t ? "background-color: transparent" : "";
}
function s(e) {
	let t = e.replace(/\s/g, "");
	return t === "rgb(0,0,0)" || t === "#000000";
}
function c(e) {
	let t = e.replace(/\s/g, "").toLowerCase(), n = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(t);
	if (n) {
		let e = parseInt(n[1], 10) / 255, t = parseInt(n[2], 10) / 255, r = parseInt(n[3], 10) / 255;
		return .2126 * e + .7152 * t + .0722 * r;
	}
	let r = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.exec(t);
	if (r) {
		let e = r[1], t = e.length === 3 ? [
			e[0] + e[0],
			e[1] + e[1],
			e[2] + e[2]
		] : [
			e.substring(0, 2),
			e.substring(2, 4),
			e.substring(4, 6)
		], n = parseInt(t[0], 16) / 255, i = parseInt(t[1], 16) / 255, a = parseInt(t[2], 16) / 255;
		return .2126 * n + .7152 * i + .0722 * a;
	}
	return -1;
}
function l(e) {
	let t = e.replace(/\s/g, "").toLowerCase();
	return t === "rgb(255,255,255)" || t === "#ffffff" || t === "white";
}
function u(e) {
	let t = c(e);
	return t >= 0 && t < .12;
}
function d(e) {
	return c(e) > .75;
}
function f(t, n, r, i, a) {
	if (!n && !r) return t;
	let s = n && i !== void 0 ? e(i, "text") : "", c = r && a !== void 0 ? e(a, "bg") : "", l = [n ? `color: ${s}` : "", o(r, n, c)].filter(Boolean).join("; ");
	return l ? `<mark style="${l};">${t}</mark>` : t;
}
function p(e, t) {
	let n = e.getAttribute("style") ?? "", r = /font-weight\s*:\s*(700|bold)/i.test(n), i = /font-style\s*:\s*italic/i.test(n), a = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(n), o = /background-color\s*:\s*([^;]+)/i.exec(n), c = a?.[1]?.trim(), p = o?.[1]?.trim(), m = t ? c !== void 0 && !s(c) : c !== void 0 && !s(c) && !d(c), h = t ? p !== void 0 && p !== "transparent" : p !== void 0 && p !== "transparent" && !l(p) && !u(p);
	if (!r && !i && !m && !h) return null;
	let g = f(e.innerHTML, m, h, c, p), _ = i ? `<i>${g}</i>` : g;
	return r ? `<b>${_}</b>` : _;
}
function m(e, t) {
	for (let n of Array.from(e.querySelectorAll("span[style]"))) {
		let e = p(n, t);
		e !== null && n.replaceWith(document.createRange().createContextualFragment(e));
	}
	t && h(e);
}
function h(t) {
	for (let n of Array.from(t.querySelectorAll("a[style]"))) {
		let t = n.getAttribute("style") ?? "", r = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(t), i = /background-color\s*:\s*([^;]+)/i.exec(t), a = r?.[1]?.trim(), c = i?.[1]?.trim(), l = a !== void 0 && !s(a) && a !== "inherit", u = c !== void 0 && c !== "transparent" && c !== "inherit";
		if (!l && !u) continue;
		let d = l ? e(a, "text") : "", f = u ? e(c, "bg") : "", p = [l ? `color: ${d}` : "", o(u, l, f)].filter(Boolean).join("; "), m = n;
		m.innerHTML = `<mark style="${p};">${m.innerHTML}</mark>`, m.style.removeProperty("color"), m.style.removeProperty("background-color");
	}
}
function g(e) {
	for (let t of Array.from(e.querySelectorAll("td, th"))) {
		let e = t.querySelectorAll("p");
		if (e.length !== 0) {
			for (let t of Array.from(e)) {
				let e = document.createRange().createContextualFragment(t.innerHTML + "<br>");
				t.replaceWith(e);
			}
			t.innerHTML = t.innerHTML.replace(/(<br\s*\/?>|\s)+$/i, "");
		}
	}
}
//#endregion
//#region src/cli/commands/convert-gdocs/index.ts
function _(e) {
	let a = i(e), o = new DOMParser().parseFromString(a, "text/html").body;
	n(o), t(o);
	let s = {
		version: "0.10.0-beta.16",
		blocks: r(o)
	};
	return JSON.stringify(s);
}
//#endregion
export { _ as convertGdocs };
