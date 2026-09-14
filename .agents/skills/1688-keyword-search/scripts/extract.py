#!/usr/bin/env python3
"""Generate a read-only 1688 search extractor for agent-browser eval."""

from __future__ import annotations

import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("keyword")
    parser.add_argument("--page", type=int, default=1)
    args = parser.parse_args()
    if args.page < 1:
        parser.error("--page must be >= 1")

    js = r'''(function () {
  try {
    const query = __QUERY__;
    const requestedPage = __PAGE__;
    const bodyText = ((document.body && (document.body.innerText || document.body.textContent)) || "")
      .replace(/\s+/g, " ").trim();
    const sourceUrl = String(location.href || "");
    const pageTitle = String(document.title || "");
    const pagePath = String(location.pathname || "");
    const pageIdentity = pageTitle + " " + pagePath + " " + sourceUrl;
    const warnings = [];
    const hasAny = (patterns, text = bodyText) => patterns.some((pattern) => pattern.test(text) || pattern.test(sourceUrl));
    const searchCardSelectors = '[data-offer-id], [data-offerid], [data-testid*="offer"], [class*="offer-item"], [class*="offerItem"], [class*="sm-offer"], [class*="product-card"], [class*="productCard"], [class*="offerCard"], [class*="search-result-item"]';
    const hasSearchContent = () => Boolean(document.querySelector(searchCardSelectors) || document.querySelector('a[href*="detail.1688.com/offer"], a[href*="1688.com/offer"], a[href*="offerId="]'));
    const statusHint = () => {
      const hasContent = hasSearchContent();
      if (hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i, /punish/i, /_____tmd_____/i], pageIdentity)
        || (!hasContent && hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i]))) return "security_verification";
      if (hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i], pageIdentity)
        || (!hasContent && hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i]))) return "site_blocked";
      if (!hasContent && hasAny([/请先登录/i, /请登录/i, /登录后/i, /扫码登录/i, /短信验证码/i, /账号确认/i, /登录可见/i])) return "authentication_required";
      if (!hasContent && hasAny([/没有找到/i, /暂无商品/i, /没有相关商品/i, /无搜索结果/i, /没有相关结果/i, /0\s*个商品/i])) return "no_results";
      return null;
    };
    const baseEnvelope = (status, items) => ({
      platform: "1688",
      query,
      page: requestedPage,
      sourceUrl,
      observedAt: new Date().toISOString(),
      items,
      warnings,
      status
    });
    const hint = statusHint();
    if (hint && hint !== "no_results") {
      warnings.push("status_hint:" + hint);
      return baseEnvelope(hint, []);
    }
    const all = (root, selector) => Array.from((root || document).querySelectorAll(selector));
    const first = (root, selectors) => {
      for (const selector of selectors) {
        const node = (root || document).querySelector(selector);
        if (node) return node;
      }
      return null;
    };
    const text = (node) => node ? String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim() : null;
    const attr = (node, names) => {
      if (!node) return null;
      for (const name of names) {
        const value = node.getAttribute && node.getAttribute(name);
        if (value) return String(value).trim();
      }
      return null;
    };
    const absolute = (value) => {
      if (!value) return null;
      try { return new URL(value, sourceUrl).href; } catch (_) { return value; }
    };
    const numberFrom = (value) => {
      if (!value) return null;
      const match = String(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    const priceAmount = (value) => {
      if (!value) return null;
      const normalized = String(value).replace(/,/g, "");
      const currencyMatch = normalized.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
      if (currencyMatch) return Number(currencyMatch[1]);
      const numbers = normalized.match(/\d+(?:\.\d+)?/g);
      return numbers && numbers.length ? Number(numbers[numbers.length - 1]) : null;
    };
    const priceInfo = (raw, kindOverride) => {
      const value = raw ? String(raw).replace(/\s+/g, " ").trim() : null;
      if (!value) return {raw: null, amount: null, kind: "unknown"};
      let kind = kindOverride || "displayed";
      if (!kindOverride && /面议|议价/.test(value)) kind = "negotiable";
      else if (!kindOverride && /\d\s*[-~至]\s*\d/.test(value)) kind = "range";
      else if (!kindOverride && /起|起批|低至/.test(value)) kind = "starting";
      // Currency-aware parsing avoids reporting MOQ or other quantity text.
      return {raw: value, amount: priceAmount(value), kind};
    };
    const imageUrl = (node) => absolute(attr(node, ["src", "data-src", "data-lazy-img", "data-original"]));
    const idFrom = (card, url, link) => {
      const nodes = [card, link, card && card.parentElement].filter(Boolean);
      const direct = nodes.map((node) => attr(node, ["data-offer-id", "data-offerid"]))
        .find((value) => /^\d{4,}$/.test(String(value || "")));
      if (direct) return {id: direct, source: "data-offer-id"};
      const hrefMatch = String(url || "").match(/[?&]offerId=(\d{4,})/i);
      if (hrefMatch && !/dj\.1688\.com\/ci_bb/i.test(url)) return {id: hrefMatch[1], source: "href"};
      for (const node of nodes) {
        const report = attr(node, ["data-aplus-report"]);
        const reportMatch = String(report || "").match(/(?:^|\^)object_id@(\d{4,})(?:\^|$)/i);
        if (reportMatch) return {id: reportMatch[1], source: "data-aplus-report"};
        const render = attr(node, ["data-renderkey"]);
        const renderMatch = String(render || "").match(/(?:_|-)(\d{4,})$/);
        if (renderMatch) return {id: renderMatch[1], source: "data-renderkey"};
      }
      if (hrefMatch) return {id: "unknown", source: "tracking"};
      try {
        const parsed = new URL(url || sourceUrl);
        const pathMatch = parsed.pathname.match(/(?:offer|product)[^0-9]*(\d{4,})/i);
        if (pathMatch) return {id: pathMatch[1], source: "url-path"};
      } catch (_) { /* malformed tracking URL remains unknown */ }
      return {id: "unknown", source: /dj\.1688\.com\/ci_bb/i.test(String(url || "")) ? "tracking" : "unknown"};
    };
    const isSponsored = (card) => /广告|推广|赞助|猜你喜欢|为你推荐/.test(text(card) || "") || /(^|[-_])ad([-_]|$)|sponsored/i.test(String(card.className || ""));
    const tierFrom = (node) => {
      const raw = attr(node, ["data-price-tier", "data-tier-price"]) || text(node);
      if (!raw) return null;
      return {
        raw,
        amount: priceAmount(raw),
        kind: "tier",
        minQty: numberFrom(attr(node, ["data-min-qty", "data-begin-amount"]) || raw)
      };
    };

    let cards = all(document, '[data-offer-id], [data-offerid], [data-testid*="offer"], [class*="offer-item"], [class*="offerItem"], [class*="sm-offer"], [class*="product-card"], [class*="productCard"], [class*="offerCard"], [class*="search-result-item"]');
    if (!cards.length) {
      const links = all(document, 'a[href*="detail.1688.com/offer"], a[href*="1688.com/offer"], a[href*="offerId="]');
      cards = links.map((link) => {
        let node = link;
        for (let depth = 0; depth < 6 && node; depth += 1, node = node.parentElement) {
          if ((node.querySelector && node.querySelector("img")) || (text(node) || "").length > 20) return node;
        }
        return link;
      });
    }
    const uniqueCards = [];
    const seenCards = new Set();
    for (const card of cards) {
      if (!seenCards.has(card)) { seenCards.add(card); uniqueCards.push(card); }
    }
    const items = uniqueCards.map((card) => {
      const link = (card.matches && card.matches("a")) ? card : first(card, ['a[href*="detail.1688.com/offer"]', 'a[href*="1688.com/offer"]', 'a[href*="offerId="]', 'a[href]']);
      const url = absolute(attr(link, ["href"]) || attr(card, ["data-url", "data-href"]));
      const img = first(card, ['[data-image]', "img"]);
      const titleNode = first(card, ['[data-title]', '[class*="offer-title"]', '[class*="offerTitle"]', '[class*="title"]', "h3", "h2"]);
      const priceNode = first(card, ['[data-price]', '[class*="price"]', '[class*=Price]']);
      const salesNode = first(card, ['[data-sales]', '[class*="trade"]', '[class*="deal"]', '[class*="sale"]']);
      const shopNode = first(card, ['[data-shop-name]', '[data-company-name]', '[class*="company"]', '[class*="shop"]', '[class*="seller"]']);
      const moqNode = first(card, ['[data-moq]', '[class*="moq"]', '[class*="order"]', '[class*="起订"]']);
      const unitNode = first(card, ['[data-unit]', '[class*="unit"]']);
      const tierNodes = all(card, '[data-price-tier], [data-tier-price], [class*="price-tier"], [class*="priceRange"]');
      const tieredPrices = tierNodes.map(tierFrom).filter(Boolean);
      const identity = idFrom(card, url, link);
      const id = String(identity.id);
      const title = text(titleNode) || attr(img, ["alt"]) || attr(link, ["title"]) || null;
      const mainRaw = attr(priceNode, ["data-price"]) || text(priceNode);
      const moqRaw = attr(moqNode, ["data-moq"]) || text(moqNode);
      if (id === "unknown") warnings.push("offer_id_missing:" + (title || "untitled"));
      return {
        id,
        title,
        url: (id !== "unknown" && identity.source !== "tracking") ? ((url && /detail\.1688\.com\/offer\//i.test(url)) ? url : `https://detail.1688.com/offer/${id}.html`) : null,
        imageUrl: imageUrl(img),
        shopName: text(shopNode),
        price: priceInfo(mainRaw),
        salesText: text(salesNode),
        sponsored: isSponsored(card),
        platformData: {
          tieredPrices,
          moq: {raw: moqRaw, amount: numberFrom(moqRaw)},
          unit: attr(unitNode, ["data-unit"]) || text(unitNode),
          companyName: attr(shopNode, ["data-company-name"]) || text(shopNode),
          location: text(first(card, ['[data-location]', '[class*="location"]'])),
          sourceLabel: attr(card, ["data-source-label"]),
          relevanceText: text(first(card, ['[data-relevance]', '[class*="relevance"]'])),
          idSource: identity.source,
          trackingUrl: identity.source === "tracking" ? (url || null) : null
        }
      };
    }).filter((item, index, list) => {
      const key = item.id !== "unknown" ? item.id : (item.url || item.title || String(index));
      return list.findIndex((candidate) => (candidate.id !== "unknown" ? candidate.id : (candidate.url || candidate.title || "")) === key) === index;
    });
    if (!items.length) {
      if (hint === "no_results") {
        warnings.push("no_results_text");
        return baseEnvelope("no_results", []);
      }
      warnings.push("no_product_cards");
      return baseEnvelope("layout_changed", []);
    }
    if (items.every((item) => item.id === "unknown" || !item.url)) {
      warnings.push("all_offer_ids_missing");
      return baseEnvelope("layout_changed", items);
    }
    return baseEnvelope("ok", items);
  } catch (error) {
    return {
      platform: "1688",
      query: __QUERY__,
      page: __PAGE__,
      sourceUrl: String(location && location.href || ""),
      observedAt: new Date().toISOString(),
      items: [],
      warnings: ["extract_error:" + String(error && error.message || error)],
      status: "layout_changed"
    };
  }
})()'''
    sys.stdout.write(js.replace("__QUERY__", json.dumps(args.keyword, ensure_ascii=False)).replace("__PAGE__", str(args.page)) + "\n")


if __name__ == "__main__":
    main()
