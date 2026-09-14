#!/usr/bin/env python3
"""Generate a read-only JD search extractor for agent-browser eval."""

from __future__ import annotations

import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("keyword")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--sort", default="")
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
    const warnings = [];
    const pageIdentity = `${String(document.title || "")} ${String(location.pathname || "")} ${sourceUrl}`;
    const hasAny = (patterns, text = bodyText) => patterns.some((pattern) => pattern.test(text) || pattern.test(sourceUrl));
    const searchCardSelectors = '#J_goodsList li.gl-item, li.gl-item, [data-sku], [data-sku-id], [data-testid*="product"], [class*="goods-item"], [class*="itemCard"], [class*="goodsItem"], [class*="product-item"], [class*="productItem"]';
    const hasSearchContent = () => Boolean(document.querySelector(searchCardSelectors) || document.querySelector('a[href*="item.jd.com"], a[href*="item.jd.hk"], a[href*="item.jd.cn"]'));
    const statusHint = () => {
      const hasContent = hasSearchContent();
      if (hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i], pageIdentity)
        || (!hasContent && hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i]))) return "security_verification";
      if (hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i, /punish/i, /_____tmd_____/i], pageIdentity)
        || (!hasContent && hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i]))) return "site_blocked";
      if (!hasContent && hasAny([/请先登录/i, /请登录/i, /登录后/i, /扫码登录/i, /短信验证码/i, /账号确认/i])) return "authentication_required";
      if (!hasContent && hasAny([/没有找到/i, /暂无商品/i, /没有相关商品/i, /无搜索结果/i, /没有相关结果/i, /0\s*个商品/i])) return "no_results";
      return null;
    };
    const baseEnvelope = (status, items) => ({
      platform: "jd",
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
    const priceInfo = (raw) => {
      const value = raw ? String(raw).replace(/\s+/g, " ").trim() : null;
      if (!value) return {raw: null, amount: null, kind: "unknown"};
      let kind = "displayed";
      if (/面议|议价/.test(value)) kind = "negotiable";
      else if (/券后|券后价/.test(value)) kind = "after_coupon";
      else if (/\d\s*[-~至]\s*\d/.test(value)) kind = "range";
      else if (/起|起批|低至/.test(value)) kind = "starting";
      return {raw: value, amount: numberFrom(value), kind};
    };
    const imageUrl = (node) => absolute(attr(node, ["src", "data-lazy-img", "data-src", "data-original"]));
    const idFrom = (card, url) => {
      const value = attr(card, ["data-sku", "data-sku-id", "data-product-id", "data-id"]);
      if (value) return value;
      try {
        const parsed = new URL(url || sourceUrl);
        const pathMatch = parsed.pathname.match(/(?:item\.jd(?:\.hk|\.cn)?\.com\/|\/(?:item|product)\/|\/)(\d{6,})(?:\.html)?/i);
        return parsed.searchParams.get("sku") || parsed.searchParams.get("skuId") || parsed.searchParams.get("sku_id") || parsed.searchParams.get("pid") || parsed.searchParams.get("id") || (pathMatch && pathMatch[1]) || "unknown";
      } catch (_) { return "unknown"; }
    };
    const isSponsored = (card, url) => /广告|推广|精选推荐|赞助/.test(text(card) || "")
      || /(^|[-_])ad([-_]|$)|ad\.jd\.com/i.test(String(card.className || ""))
      || /adurl|adid/i.test(url || "");

    // JD has several concurrent card implementations (legacy search, React and
    // advertising feed). Prefer elements carrying a product identity, then use
    // the product URL as the identity when data-sku is rendered only in React.
    let cards = all(document, '#J_goodsList li.gl-item, li.gl-item, [data-sku], [data-sku-id], [data-testid*="product"], [class*="goods-item"], [class*="itemCard"], [class*="goodsItem"], [class*="product-item"], [class*="productItem"]');
    if (!cards.length) {
      const links = all(document, 'a[href*="item.jd.com"], a[href*="item.jd.hk"], a[href*="item.jd.cn"]');
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
      const link = first(card, ['a[href*="item.jd.com"]', 'a[href*="item.jd.hk"]', 'a[href*="item.jd.cn"]', 'a[href]']);
      const url = absolute(attr(link, ["href"]) || attr(card, ["data-url", "data-href"]));
      const img = first(card, [".p-img img", '[data-image]', "img"]);
      const titleNode = first(card, ['[data-title]', ".p-name a", ".p-name", '[class*="title"]', "h3", "h2"]);
      const priceNode = first(card, ['[data-price]', ".p-price .J_price", ".p-price i", '[class*="price"]', '[class*=Price]']);
      const salesNode = first(card, ['[data-sales]', '[class*="sell"]', '[class*="sale"]']);
      const commentNode = first(card, ['[data-comment-count]', ".p-commit a", ".p-commit", '[class*="comment"]', '[class*="Comment"]']);
      const shopNode = first(card, ['[data-shop-name]', ".p-shop a", ".p-shop", '[class*="shop"]']);
      const locationNode = first(card, ['[data-location]', ".p-stock", '[class*="location"]']);
      const skuNode = first(card, ['[data-sku-text]', '[class*="sku"]']);
      const id = String(idFrom(card, url));
      const title = text(titleNode) || attr(img, ["alt"]) || attr(link, ["title"]) || null;
      if (id === "unknown") warnings.push("item_id_missing:" + (title || "untitled"));
      const canonicalUrl = (url && /chat\.jd\.com/i.test(url))
        ? (() => { try { const parsed = new URL(url); const pid = parsed.searchParams.get("pid"); return pid ? `https://item.jd.com/${pid}.html` : url; } catch (_) { return url; } })()
        : url;
      return {
        id,
        title,
        url: canonicalUrl || null,
        imageUrl: imageUrl(img),
        shopName: text(shopNode),
        price: priceInfo(attr(priceNode, ["data-price"]) || text(priceNode)),
        salesText: text(salesNode),
        sponsored: isSponsored(card, url),
        platformData: {
          commentCountText: text(commentNode),
          location: text(locationNode),
          skuText: text(skuNode),
          sourceLabel: attr(card, ["data-source-label"])
        }
      };
    }).filter((item, index, list) => {
      const key = item.id !== "unknown" ? item.id : (item.url || item.title || String(index));
      return list.findIndex((candidate) => (candidate.id !== "unknown" ? candidate.id : (candidate.url || candidate.title || "")) === key) === index;
    });
    // A lazy-rendered page can expose anchors before its card container. Give
    // callers an explicit diagnostic so they can scroll/wait and retry.
    if (!items.length) {
      if (hint === "no_results") {
        warnings.push("no_results_text");
        return baseEnvelope("no_results", []);
      }
      warnings.push("no_product_cards");
      return baseEnvelope("layout_changed", []);
    }
    if (items.every((item) => item.id === "unknown" || !item.url)) {
      warnings.push("all_item_ids_missing");
      return baseEnvelope("layout_changed", items);
    }
    return baseEnvelope("ok", items);
  } catch (error) {
    return {
      platform: "jd",
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
