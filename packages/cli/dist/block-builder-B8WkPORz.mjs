//#region src/components/shared/color-presets.ts
var e = [
	{
		name: "gray",
		text: "#787774",
		bg: "#f1f1ef"
	},
	{
		name: "brown",
		text: "#9f6b53",
		bg: "#f4eeee"
	},
	{
		name: "orange",
		text: "#d9730d",
		bg: "#fbecdd"
	},
	{
		name: "yellow",
		text: "#cb9b00",
		bg: "#fbf3db"
	},
	{
		name: "green",
		text: "#448361",
		bg: "#edf3ec"
	},
	{
		name: "blue",
		text: "#337ea9",
		bg: "#e7f3f8"
	},
	{
		name: "purple",
		text: "#9065b0",
		bg: "#f6f3f9"
	},
	{
		name: "pink",
		text: "#c14c8a",
		bg: "#f9f0f5"
	},
	{
		name: "red",
		text: "#d44c47",
		bg: "#fdebec"
	}
], t = [
	{
		name: "gray",
		text: "#9b9b9b",
		bg: "#2f2f2f"
	},
	{
		name: "brown",
		text: "#c59177",
		bg: "#452a1c"
	},
	{
		name: "orange",
		text: "#dc8c47",
		bg: "#4d2f14"
	},
	{
		name: "yellow",
		text: "#d4ab49",
		bg: "#544012"
	},
	{
		name: "green",
		text: "#5db184",
		bg: "#1e432f"
	},
	{
		name: "blue",
		text: "#5c9fcc",
		bg: "#123a54"
	},
	{
		name: "purple",
		text: "#a67dca",
		bg: "#341d49"
	},
	{
		name: "pink",
		text: "#d45e99",
		bg: "#4b1b33"
	},
	{
		name: "red",
		text: "#dd5e5a",
		bg: "#4e1a18"
	}
];
//#endregion
//#region src/components/utils/color-mapping.ts
function n(e, t, n) {
	let r = t / 100, i = n / 100;
	if (r === 0) {
		let e = Math.round(i * 255);
		return [
			e,
			e,
			e
		];
	}
	let a = (e) => e < 0 ? e + 1 : e > 1 ? e - 1 : e, o = (e, t, n) => {
		let r = a(n);
		return r < 1 / 6 ? e + (t - e) * 6 * r : r < 1 / 2 ? t : r < 2 / 3 ? e + (t - e) * (2 / 3 - r) * 6 : e;
	}, s = i < .5 ? i * (1 + r) : i + r - i * r, c = 2 * i - s, l = e / 360;
	return [
		Math.round(o(c, s, l + 1 / 3) * 255),
		Math.round(o(c, s, l) * 255),
		Math.round(o(c, s, l - 1 / 3) * 255)
	];
}
function r(e) {
	let t = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(e);
	if (t) return [
		parseInt(t[1], 16),
		parseInt(t[2], 16),
		parseInt(t[3], 16)
	];
	let r = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})[0-9a-f]{2}$/i.exec(e);
	if (r) return [
		parseInt(r[1], 16),
		parseInt(r[2], 16),
		parseInt(r[3], 16)
	];
	let i = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(e);
	if (i) return [
		parseInt(i[1] + i[1], 16),
		parseInt(i[2] + i[2], 16),
		parseInt(i[3] + i[3], 16)
	];
	let a = /^#([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]$/i.exec(e);
	if (a) return [
		parseInt(a[1] + a[1], 16),
		parseInt(a[2] + a[2], 16),
		parseInt(a[3] + a[3], 16)
	];
	let o = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(e);
	if (o) return [
		Number(o[1]),
		Number(o[2]),
		Number(o[3])
	];
	let s = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(e);
	return s ? n(Number(s[1]), Number(s[2]), Number(s[3])) : null;
}
var i = .1;
function a(e) {
	let t = e[0] / 255, n = e[1] / 255, r = e[2] / 255, i = Math.max(t, n, r), a = Math.min(t, n, r), o = (i + a) / 2;
	if (i === a) return [
		0,
		0,
		o
	];
	let s = i - a, c = o > .5 ? s / (2 - i - a) : s / (i + a);
	return [
		((e) => e === t ? ((n - r) / s + (n < r ? 6 : 0)) / 6 : e === n ? ((r - t) / s + 2) / 6 : ((t - n) / s + 4) / 6)(i) * 360,
		c,
		o
	];
}
function o(e, t) {
	let n = e[1] < i, r = t[1] < i;
	if (n && r) {
		let n = Math.abs(e[2] - t[2]);
		return n * n;
	}
	if (n !== r) return 1e3;
	let a = Math.abs(e[0] - t[0]), o = Math.min(a, 360 - a) / 180, s = Math.abs(e[1] - t[1]), c = Math.abs(e[2] - t[2]);
	return 8 * o * o + 1 * s * s + 1 * c * c;
}
function s(t, n) {
	let i = r(t);
	if (i === null) return t;
	let s = a(i);
	return e.reduce((e, t) => {
		let i = r(t[n]);
		if (i === null) return e;
		let c = o(s, a(i));
		return c < e.distance ? {
			color: t[n],
			distance: c
		} : e;
	}, {
		color: t,
		distance: Infinity
	}).color;
}
function c(n, i) {
	let s = r(n);
	if (s === null) return null;
	let c = a(s);
	return [...e, ...t].reduce((e, t) => {
		let n = r(t[i]);
		if (n === null) return e;
		let s = o(c, a(n));
		return e === null || s < e.distance ? {
			name: t.name,
			distance: s
		} : e;
	}, null)?.name ?? null;
}
//#endregion
//#region src/cli/commands/convert-html/preprocessor.ts
function l(e) {
	u(e), m(e), v(e), b(e), x(e), C(e);
}
function u(e) {
	let t = e.ownerDocument;
	for (let n of Array.from(e.querySelectorAll("div[style]"))) {
		if (n.closest("table")) continue;
		let e = _(n);
		if (!e || h(e)) continue;
		let r = t.createElement("aside");
		r.style.backgroundColor = e, r.append(...Array.from(n.childNodes)), d(r), f(r), n.replaceWith(r);
	}
}
function d(e) {
	for (;;) {
		let t = Array.from(e.querySelectorAll(":scope > div")).filter((e) => !e.getAttribute("style") && !e.getAttribute("class"));
		if (t.length === 0) break;
		for (let e of t) e.replaceWith(...Array.from(e.childNodes));
	}
}
function f(e) {
	for (let t of Array.from(e.querySelectorAll("p"))) {
		let e = t.lastElementChild;
		e?.tagName === "BR" && e.remove();
	}
}
var p = 250;
function m(e) {
	let t = e.querySelectorAll("[style*=\"background-color\"]");
	for (let e of Array.from(t)) h(e.style.backgroundColor) && (e.style.removeProperty("background-color"), e.getAttribute("style")?.trim() === "" && e.removeAttribute("style"), g(e) && e.replaceWith(...Array.from(e.childNodes)));
}
function h(e) {
	if (!e) return !1;
	let t = e.replace(/\s/g, "").toLowerCase();
	if (t === "transparent") return !0;
	let n = t.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([^)]+))?\)$/);
	if (!n) return !1;
	if ((n[4] === void 0 ? 1 : parseFloat(n[4])) === 0) return !0;
	let r = parseInt(n[1], 10), i = parseInt(n[2], 10), a = parseInt(n[3], 10);
	return r >= p && i >= p && a >= p;
}
function g(e) {
	return e.attributes.length > 0 ? !1 : (e.textContent ?? "").replace(/[\s\u00A0]/g, "").length === 0;
}
function _(e) {
	if (e.style.backgroundColor) return e.style.backgroundColor;
	let t = (e.getAttribute("style") ?? "").match(/background:\s*([^;]+)/i);
	if (t) {
		let e = t[1].trim().match(/^(rgb[a]?\([^)]+\)|#[0-9a-fA-F]{3,8}|[a-z]+)$/i);
		if (e) return e[1];
	}
	return "";
}
function v(e) {
	for (let t of Array.from(e.querySelectorAll("td, th"))) {
		let e = t.querySelectorAll("p");
		if (e.length !== 0) {
			for (let t of Array.from(e)) y(t);
			D(t);
		}
	}
}
function y(e) {
	if (e.innerHTML.trim() === "" || e.innerHTML.trim() === "&nbsp;") {
		e.remove();
		return;
	}
	let t = e.ownerDocument, n = t.createDocumentFragment();
	n.append(...Array.from(e.childNodes)), n.append(t.createElement("br")), e.replaceWith(n);
}
function b(e) {
	for (let t of Array.from(e.querySelectorAll("p"))) t.closest("td") || t.closest("th") || (t.textContent ?? "").replace(/[\s\u00A0]/g, "").length === 0 && t.remove();
}
function x(e) {
	let t = e.ownerDocument;
	for (let n of Array.from(e.querySelectorAll("del, strike"))) {
		let e = t.createElement("s");
		e.append(...Array.from(n.childNodes)), n.replaceWith(e);
	}
}
var S = /^[\u2022\u00B7][\s\u00A0]*|^-\s/;
function C(e) {
	let t = e.ownerDocument, n = T(e);
	for (let e of n) {
		let n = t.createElement("ul");
		e[0].before(n);
		for (let t of e) w(t, n);
	}
}
function w(e, t) {
	let n = e.ownerDocument.createElement("li"), r = O(e);
	r && (r.textContent = (r.textContent ?? "").replace(S, "")), n.append(...Array.from(e.childNodes)), t.appendChild(n), e.remove();
}
function T(e) {
	let t = [], n = Array.from(e.childNodes);
	for (let e of n) {
		if (e.nodeType !== Node.ELEMENT_NODE) continue;
		let n = e;
		if (!(n.tagName === "P" && S.test(n.textContent ?? ""))) continue;
		let r = t[t.length - 1], i = E(n);
		r && i !== null && r[r.length - 1] === i ? r.push(n) : t.push([n]);
	}
	return t;
}
function E(e) {
	let t = e.previousSibling;
	return t && t.nodeType === Node.ELEMENT_NODE ? t : null;
}
function D(e) {
	for (;;) {
		let t = e.lastChild;
		if (!t) break;
		let n = t.nodeType === Node.ELEMENT_NODE && t.tagName === "BR", r = t.nodeType === Node.TEXT_NODE && t.textContent?.trim() === "";
		if (!n && !r) break;
		t.remove();
	}
}
function O(e) {
	if (e.nodeType === Node.TEXT_NODE) return e;
	for (let t of Array.from(e.childNodes)) {
		let e = O(t);
		if (e) return e;
	}
	return null;
}
//#endregion
//#region src/cli/commands/convert-html/sanitizer.ts
var k = {
	B: !0,
	STRONG: !0,
	I: !0,
	EM: !0,
	A: new Set(["href"]),
	S: !0,
	U: !0,
	CODE: !0,
	MARK: new Set(["style"]),
	BR: !0,
	P: !0,
	H1: !0,
	H2: !0,
	H3: !0,
	H4: !0,
	H5: !0,
	H6: !0,
	UL: !0,
	OL: !0,
	LI: new Set(["aria-level"]),
	TABLE: !0,
	THEAD: !0,
	TBODY: !0,
	TR: !0,
	TD: new Set(["style"]),
	TH: new Set(["style"]),
	BLOCKQUOTE: !0,
	PRE: !0,
	HR: !0,
	ASIDE: new Set(["style"]),
	DETAILS: !0,
	SUMMARY: !0,
	IMG: new Set(["src", "style"])
};
function A(e) {
	N(e);
}
function j(e) {
	let t = Array.from(e.childNodes);
	for (let n of t) e.before(n);
	return e.remove(), t.filter((e) => e.nodeType === e.ELEMENT_NODE);
}
function M(e, t) {
	for (let n of Array.from(e.attributes)) (t === !0 || !t.has(n.name)) && e.removeAttribute(n.name);
}
function N(e) {
	let t = Array.from(e.childNodes);
	for (let e of t) {
		if (e.nodeType !== e.ELEMENT_NODE) continue;
		let n = e, r = k[n.tagName];
		if (r === void 0) {
			t.push(...j(n));
			continue;
		}
		M(n, r), N(n);
	}
}
//#endregion
//#region src/cli/commands/convert-html/id-generator.ts
function P() {
	let e = /* @__PURE__ */ new Map();
	return (t) => {
		let n = (e.get(t) ?? 0) + 1;
		return e.set(t, n), `${t}-${n}`;
	};
}
//#endregion
//#region src/cli/commands/convert-html/block-builder.ts
function F(e) {
	let t = P(), n = [];
	for (let r of Array.from(e.childNodes)) I(r, n, t);
	return n;
}
function I(e, t, n) {
	if (e.nodeType === Node.TEXT_NODE) {
		let r = e.textContent?.trim() ?? "";
		r && t.push({
			id: n("paragraph"),
			type: "paragraph",
			data: { text: r }
		});
		return;
	}
	if (e.nodeType !== Node.ELEMENT_NODE) return;
	let r = e, i = r.tagName;
	if (i === "P") {
		t.push({
			id: n("paragraph"),
			type: "paragraph",
			data: { text: r.innerHTML }
		});
		return;
	}
	if (/^H[1-6]$/.test(i)) {
		let e = Number(i[1]);
		t.push({
			id: n("header"),
			type: "header",
			data: {
				text: r.innerHTML,
				level: e
			}
		});
		return;
	}
	if (i === "BLOCKQUOTE") {
		t.push({
			id: n("quote"),
			type: "quote",
			data: {
				text: r.innerHTML,
				size: "default"
			}
		});
		return;
	}
	if (i === "PRE") {
		t.push({
			id: n("code"),
			type: "code",
			data: {
				code: r.textContent ?? "",
				language: "plain-text"
			}
		});
		return;
	}
	if (i === "HR") {
		t.push({
			id: n("divider"),
			type: "divider",
			data: {}
		});
		return;
	}
	if (i === "IMG") {
		let e = r.getAttribute("src") ?? "", i = H(r, "width");
		t.push({
			id: n("image"),
			type: "image",
			data: { url: e },
			stretched: null,
			key: null,
			width: i
		});
		return;
	}
	if (i === "DETAILS") {
		let e = r.querySelector("summary"), i = e ? e.innerHTML : r.innerHTML;
		t.push({
			id: n("toggle"),
			type: "toggle",
			data: { text: i }
		});
		return;
	}
	if (i === "UL" || i === "OL") {
		L(r, i === "OL" ? "ordered" : "unordered", 0, t, n);
		return;
	}
	if (i === "TABLE") {
		R(r, t, n);
		return;
	}
	if (i === "ASIDE") {
		z(r, t, n);
		return;
	}
	t.push({
		id: n("paragraph"),
		type: "paragraph",
		data: { text: r.innerHTML }
	});
}
function L(e, t, n, r, i) {
	let a = e.getAttribute("start"), o = a ? Number(a) : null, s = Array.from(e.children).filter((e) => e.tagName === "LI");
	for (let [e, a] of s.entries()) {
		let s = a.cloneNode(!0), c = [];
		for (let e of Array.from(s.querySelectorAll("ul, ol"))) c.push(e.cloneNode(!0)), e.remove();
		let l = s.innerHTML.trim(), u = a.getAttribute("aria-level"), d = u ? Math.max(0, parseInt(u, 10) - 1) : n;
		r.push({
			id: i("list"),
			type: "list",
			data: {
				text: l,
				style: t,
				depth: d === 0 ? null : d,
				checked: null,
				start: e === 0 && o !== null ? o : null
			}
		});
		for (let e of c) L(e, e.tagName === "OL" ? "ordered" : "unordered", n + 1, r, i);
	}
}
function R(e, t, n) {
	let r = n("table"), i = Array.from(e.querySelectorAll("tr")), a = [];
	for (let e of i) {
		let i = Array.from(e.querySelectorAll("td, th")).map((e) => B(e, r, t, n));
		a.push(i);
	}
	let o = i[0] ? Array.from(i[0].querySelectorAll("td, th")) : [], s = o.some((e) => e.tagName === "TH"), c = o.map((e) => {
		let t = U(e, "width");
		if (t) {
			let e = parseInt(t, 10);
			return isNaN(e) ? null : e;
		}
		return null;
	}), l = {
		id: r,
		type: "table",
		data: {
			withHeadings: s,
			withHeadingColumn: !1,
			content: a,
			...c.some((e) => e !== null) ? { colWidths: c } : {}
		}
	}, u = t.findIndex((e) => e.parent === r);
	u >= 0 ? t.splice(u, 0, l) : t.push(l);
}
function z(e, t, n) {
	let r = n("callout"), i = U(e, "background-color"), a = i ? c(i, "bg") : null, o = [];
	for (let i of Array.from(e.childNodes)) {
		let e = V(i, r, t, n);
		e && o.push(e);
	}
	let s = t.findIndex((e) => e.parent === r), l = {
		id: r,
		type: "callout",
		data: {
			emoji: "💡",
			backgroundColor: a ?? "gray"
		},
		content: o
	};
	s >= 0 ? t.splice(s, 0, l) : t.push(l);
}
function B(e, t, n, r) {
	let i = e.innerHTML.trim();
	if (!i) return {
		blocks: [],
		color: null,
		textColor: null
	};
	let a = r("paragraph");
	n.push({
		id: a,
		type: "paragraph",
		parent: t,
		data: { text: i }
	});
	let o = U(e, "background-color"), s = U(e, "color");
	return {
		blocks: [a],
		color: o ? c(o, "bg") : null,
		textColor: s ? c(s, "text") : null
	};
}
function V(e, t, n, r) {
	if (e.nodeType === Node.ELEMENT_NODE) {
		let i = e, a = r("paragraph");
		return n.push({
			id: a,
			type: "paragraph",
			parent: t,
			data: { text: i.innerHTML }
		}), a;
	}
	if (e.nodeType === Node.TEXT_NODE) {
		let i = e.textContent?.trim() ?? "";
		if (!i) return null;
		let a = r("paragraph");
		return n.push({
			id: a,
			type: "paragraph",
			parent: t,
			data: { text: i }
		}), a;
	}
	return null;
}
function H(e, t) {
	let n = U(e, t);
	if (!n) return null;
	let r = parseInt(n, 10);
	return isNaN(r) ? null : r;
}
function U(e, t) {
	let n = e.getAttribute("style");
	if (!n) return null;
	let r = RegExp(`(?<![\\-a-z])${t}\\s*:\\s*([^;]+)`).exec(n);
	return r ? r[1].trim() : null;
}
//#endregion
export { s as i, A as n, l as r, F as t };
