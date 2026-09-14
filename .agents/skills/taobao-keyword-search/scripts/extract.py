#!/usr/bin/env python3
"""Generate a read-only Taobao/Tmall search extractor for agent-browser eval."""

import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("keyword")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--sort", default="")
    parser.add_argument("--tab", default="")
    parser.add_argument("--start-price", default="")
    parser.add_argument("--end-price", default="")
    args = parser.parse_args()

    if args.page < 1:
        parser.error("--page must be >= 1")
    if args.sort not in {"", "sale-desc", "price-asc", "price-desc"}:
        parser.error("unsupported --sort")
    if args.tab not in {"", "mall"}:
        parser.error("unsupported --tab")

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
    const searchCardSelectors = '[id^="item_id_"], [data-item-id], [data-product-id], [data-testid*="product"], [class*="itemCard"], [class*="ItemCard"], [class*="goods-item"], [class*="offer-item"]';
    const hasSearchContent = () => Boolean(document.querySelector(searchCardSelectors) || document.querySelector('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]'));
    const statusHint = () => {
      const hasContent = hasSearchContent();
      if (hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i], pageIdentity)
        || (!hasContent && hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i]))) return "security_verification";
      if (hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i, /punish/i, /_____tmd_____/i], pageIdentity)
        || (!hasContent && hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i]))) return "site_blocked";
      if (!hasContent && hasAny([/请先登录/i, /请登录/i, /登录后/i, /扫码登录/i, /短信验证码/i, /账号确认/i, /亲，请登录/i])) return "authentication_required";
      if (!hasContent && hasAny([/没有找到/i, /暂无商品/i, /没有相关商品/i, /无搜索结果/i, /没有相关结果/i, /0\s*个商品/i])) return "no_results";
      return null;
    };
    const baseEnvelope = (status, items) => ({
      platform: "taobao",
      query,
      page: requestedPage,
      sourceUrl,
      observedAt: new Date().toISOString(),
      items,
      warnings,
      status
    });
    const status = statusHint();
    if (status && status !== "ok" && status !== "no_results") {
      warnings.push("status_hint:" + status);
      return baseEnvelope(status, []);
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
    const imageUrl = (node) => absolute(attr(node, ["src", "data-src", "data-lazy-img", "data-original"]));
    const cardId = (card, url) => {
      const value = attr(card, ["data-item-id", "data-id", "data-product-id"]);
      if (value) return value;
      if (card.id && /^item_id_\d+/.test(card.id)) return card.id.replace(/^item_id_/, "");
      try {
        const parsed = new URL(url || sourceUrl);
        return parsed.searchParams.get("id") || parsed.searchParams.get("itemId") || "unknown";
      } catch (_) { return "unknown"; }
    };
    const isSponsored = (card, url) => /广告|推广|直通车|赞助/.test(text(card) || "")
      || /simba\.taobao\.com|ad\.taobao\.com/i.test(url || "")
      || /(^|[-_])ad([-_]|$)|sponsored/i.test(String(card.className || ""));

    let cards = all(document,
      '[id^="item_id_"], [data-item-id], [data-product-id], [data-testid*="product"], [class*="itemCard"], [class*="ItemCard"], [class*="goods-item"], [class*="offer-item"]');
    if (!cards.length) {
      const links = all(document, 'a[href*="item.taobao.com"], a[href*="detail.tmall.com"]');
      const fallback = [];
      for (const link of links) {
        let node = link;
        for (let depth = 0; depth < 6 && node; depth += 1, node = node.parentElement) {
          if ((node.querySelector && node.querySelector("img")) || (text(node) || "").length > 20) {
            fallback.push(node);
            break;
          }
        }
      }
      cards = fallback;
    }
    const uniqueCards = [];
    const seenCards = new Set();
    for (const card of cards) {
      if (!seenCards.has(card)) { seenCards.add(card); uniqueCards.push(card); }
    }

    const items = uniqueCards.map((card) => {
      const link = first(card, ['a[href*="item.taobao.com"]', 'a[href*="detail.tmall.com"]', 'a[href]']);
      const rawUrl = attr(link, ["href"]) || attr(card, ["data-url", "data-href"]);
      const url = absolute(rawUrl);
      const img = first(card, ["img.mainImg", 'img[class*="mainImg"]', "img"]);
      const titleNode = first(card, ['[data-title]', '[class*="title--"]', '[class*="itemTitle"]', '[class*="title"]', "h3", "h2"]);
      const priceNode = first(card, ['[data-price]', '[class*="priceInt"]', '[class*="price"]', "[class*=Price]"]);
      const salesNode = first(card, ['[data-sales]', '[class*="realSales"]', '[class*="sales"]', '[class*="sale"]', '[class*="sell"]']);
      const shopNode = first(card, ['[data-shop-name]', '[class*="shopNameText"]', '[class*="shopName"]', '[class*="shop"]']);
      const subtitleNode = first(card, ['[data-subtitle]', '[class*="subTitle"]']);
      const locationNode = first(card, ['[data-location]', '[class*="provcity"]', '[class*="location"]']);
      const ratingNode = first(card, ['[data-rating]', '[class*="shopRating"]', '[class*="rating"]']);
      const tags = all(card, '[data-tag], [class*="tag--"], [class*="Tag--"], [class*="label--"]')
        .map(text).filter(Boolean).slice(0, 8);
      const id = String(cardId(card, url));
      const title = text(titleNode) || attr(img, ["alt"]) || null;
      const salesText = text(salesNode);
      if (id === "unknown") warnings.push("item_id_missing:" + (title || "untitled"));
      return {
        id,
        title,
        url: url || null,
        imageUrl: imageUrl(img),
        shopName: text(shopNode),
        price: priceInfo(text(priceNode) || attr(priceNode, ["data-price"])),
        salesText,
        sponsored: isSponsored(card, url),
        platformData: {
          subtitle: text(subtitleNode),
          location: text(locationNode),
          ratingText: text(ratingNode),
          tags
        }
      };
    }).filter((item, index, list) => {
      const key = item.id !== "unknown" ? item.id : (item.url || item.title || String(index));
      return list.findIndex((candidate) => (candidate.id !== "unknown" ? candidate.id : (candidate.url || candidate.title || "")) === key) === index;
    });

    if (!items.length) {
      if (status === "no_results") {
        warnings.push("no_results_text");
        return baseEnvelope("no_results", []);
      }
      warnings.push("no_product_cards");
      return baseEnvelope("layout_changed", []);
    }
    if (items.every((item) => item.id === "unknown")) {
      warnings.push("all_item_ids_missing");
      return baseEnvelope("layout_changed", items);
    }
    if (status === "no_results") warnings.push("page_contains_no_results_text_but_cards_were_read");
    return baseEnvelope("ok", items);
  } catch (error) {
    return {
      platform: "taobao",
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
    js = js.replace("__QUERY__", json.dumps(args.keyword, ensure_ascii=False))
    js = js.replace("__PAGE__", str(args.page))
    sys.stdout.write(js + "\n")


if __name__ == "__main__":
    main()
