#!/usr/bin/env python3
"""Generate a read-only JD detail extractor for agent-browser eval."""

from __future__ import annotations

import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sku_id")
    args = parser.parse_args()
    if not args.sku_id.strip():
        parser.error("sku_id is required")

    js = r'''(function () {
  const requestedId = __ID__;
  const empty = (status, warnings, sourceUrl, title, pageId) => ({
    platform: "jd",
    id: String(pageId || requestedId || "unknown"),
    title: title || null,
    sourceUrl: sourceUrl || String(location.href || ""),
    observedAt: new Date().toISOString(),
    shop: {name: null, url: null, id: null},
    price: {raw: null, amount: null, kind: "unknown", originalRaw: null, originalAmount: null, skuResolved: false},
    images: [],
    skuGroups: [],
    skuResolved: false,
    attributes: {},
    availabilityText: null,
    shippingText: null,
    promotions: [],
    warnings: warnings || [],
    status
  });
  try {
    const sourceUrl = String(location.href || "");
    const bodyText = ((document.body && (document.body.innerText || document.body.textContent)) || "")
      .replace(/\s+/g, " ").trim();
    const warnings = ["sku_not_explicitly_resolved"];
    const pageIdentity = `${String(document.title || "")} ${String(location.pathname || "")} ${sourceUrl}`;
    const hasAny = (patterns, text = bodyText) => patterns.some((pattern) => pattern.test(text) || pattern.test(sourceUrl));
    const detailTitleSelectors = '#name, [data-title], .sku-name, [class*="sku-name"], h1, [class*="product-title"]';
    const hasDetailContent = () => Array.from(document.querySelectorAll(detailTitleSelectors)).some((node) => String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim());
    const statusHint = () => {
      const hasContent = hasDetailContent();
      if (hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i], pageIdentity)
        || (!hasContent && hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i]))) return "security_verification";
      if (hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i, /punish/i, /_____tmd_____/i], pageIdentity)
        || (!hasContent && hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i]))) return "site_blocked";
      if (!hasContent && hasAny([/请先登录/i, /请登录/i, /登录后/i, /扫码登录/i, /短信验证码/i, /账号确认/i])) return "authentication_required";
      if (!hasContent && hasAny([/商品不存在/i, /页面不存在/i, /找不到该商品/i, /抱歉/i])) return "no_results";
      return null;
    };
    const hint = statusHint();
    let pageId = requestedId;
    const urlMatch = sourceUrl.match(/item\.jd(?:\.hk)?\.com\/(\d+)/i) || sourceUrl.match(/\/(\d{6,})\.html/i);
    try {
      const parsed = new URL(sourceUrl);
      pageId = parsed.searchParams.get("sku") || parsed.searchParams.get("skuId") || (urlMatch && urlMatch[1]) || requestedId;
    } catch (_) { if (urlMatch) pageId = urlMatch[1]; }
    if (hint) {
      warnings.unshift("status_hint:" + hint);
      return empty(hint, warnings, sourceUrl, null, pageId);
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
    const titleNode = first(document, ['#name', '[data-title]', '.sku-name', '[class*="sku-name"]', 'h1', '[class*="product-title"]']);
    const title = text(titleNode) || attr(document.querySelector('meta[property="og:title"]'), ["content"]);
    if (!title) {
      warnings.push("title_missing");
      return empty(hint === "no_results" ? "no_results" : "layout_changed", warnings, sourceUrl, null, pageId);
    }
    if (String(requestedId) !== String(pageId)) {
      warnings.push("page_id_mismatch");
      return empty("layout_changed", warnings, sourceUrl, title, pageId);
    }

    const priceNode = first(document, ['[data-price]', '#jd-price', '.p-price', '[class*="price"]', '[class*=Price]']);
    const price = priceInfo(attr(priceNode, ["data-price"]) || text(priceNode));
    const originalNode = first(document, ['[data-original-price]', '.p-price-del', '[class*="originalPrice"]', '[class*="del"]', 'del']);
    const originalRaw = attr(originalNode, ["data-original-price"]) || text(originalNode);
    price.originalRaw = originalRaw || null;
    price.originalAmount = numberFrom(originalRaw);
    price.skuResolved = false;

    const shopNode = first(document, ['[data-shop-name]', '.follow-shop', '.J-hove', '#popbox .mt a', '[class*="shop-name"]', '[class*="shopName"]']);
    const shopLink = first(document, ['[data-shop-url]', 'a[href*="mall.jd.com"]', 'a[href*="jd.com/shop"]', '[class*="shop"] a[href]']);
    const shopUrl = absolute(attr(shopLink, ["href"]) || attr(shopNode, ["data-shop-url"]));
    const shopName = attr(shopNode, ["data-shop-name"]) || text(shopNode) || text(shopLink);
    const shopIdMatch = String(shopUrl || "").match(/(?:shop|venderId|id)[=/](\d+)/i);

    const seenImages = new Set();
    const images = [];
    for (const img of all(document, '[data-gallery] img, .spec-items img, [class*="gallery"] img, [class*="Gallery"] img, img[data-image]')) {
      let value = attr(img, ["src", "data-lazy-img", "data-src", "data-original", "data-image"]);
      if (!value) continue;
      value = absolute(value);
      if (!value || !/360buyimg\.com|jd\.com/i.test(value)) continue;
      if (!seenImages.has(value)) { seenImages.add(value); images.push(value); }
      if (images.length >= 20) break;
    }

    const skuGroups = [];
    for (const group of all(document, '[data-sku-group], [class*="skuGroup"], [class*="spec-group"], [class*="choose-attr"]')) {
      const name = attr(group, ["data-sku-name", "data-name"]) || text(first(group, ['[class*="name"]', '[class*="title"]', "dt", "label"])) || "unknown";
      const options = all(group, '[data-sku-option], [data-value], [class*="item"] a, [class*="value"], option')
        .map((option) => ({label: attr(option, ["data-sku-option", "data-value", "title"]) || text(option), selected: /selected|checked|current|active/i.test(String(option.className || "")) || option.getAttribute && option.getAttribute("aria-selected") === "true"}))
        .filter((option) => option.label);
      if (options.length) skuGroups.push({name, options});
    }
    if (!skuGroups.length) {
      const options = all(document, '[data-sku-option], [class*="valueItem"]').map((node) => text(node)).filter(Boolean);
      if (options.length) skuGroups.push({name: "unknown", options: options.map((label) => ({label, selected: false}))});
    }

    const attributes = {};
    for (const row of all(document, '[data-attribute-row], #parameter2 li, .Ptable-item, table tr, [class*="attribute"] li')) {
      const key = attr(row, ["data-key"]) || text(first(row, ["th", "dt", '[class*="key"]', '[class*="label"]']));
      const value = attr(row, ["data-value"]) || text(first(row, ["td", "dd", '[class*="value"]', '[class*="val"]'])) || (key ? text(row).replace(key, "").trim() : null);
      if (key && value && key !== value) attributes[key] = value;
    }
    const matchText = (selectors, pattern) => {
      const node = first(document, selectors);
      const value = attr(node, ["data-text"]) || text(node);
      if (value) return value;
      const match = bodyText.match(pattern);
      return match ? match[0].trim() : null;
    };
    const availabilityText = matchText(['[data-availability]', '[class*="stock"]', '[class*="inventory"]', '[class*="availability"]'], /现货|有货|缺货|库存\s*[：:]?\s*\d+|暂不销售/);
    const shippingText = matchText(['[data-shipping]', '[class*="shipping"]', '[class*="freight"]', '[class*="delivery"]'], /运费[^。；，]{0,30}|配送[^。；，]{0,30}/);
    const promotions = [];
    const seenPromotions = new Set();
    for (const node of all(document, '[data-promotion], [class*="promotion"], [class*="Promotion"], [class*="coupon"], [class*="优惠"]')) {
      const value = attr(node, ["data-promotion"]) || text(node);
      if (value && !seenPromotions.has(value)) { seenPromotions.add(value); promotions.push(value); }
      if (promotions.length >= 20) break;
    }
    return {
      platform: "jd",
      id: String(pageId || requestedId || "unknown"),
      title,
      sourceUrl,
      observedAt: new Date().toISOString(),
      shop: {name: shopName || null, url: shopUrl || null, id: shopIdMatch ? shopIdMatch[1] : null},
      price,
      images,
      skuGroups,
      skuResolved: false,
      attributes,
      availabilityText,
      shippingText,
      promotions,
      warnings,
      status: "ok"
    };
  } catch (error) {
    return empty("layout_changed", ["extract_error:" + String(error && error.message || error)], String(location && location.href || ""), null, requestedId);
  }
})()'''
    sys.stdout.write(js.replace("__ID__", json.dumps(args.sku_id, ensure_ascii=False)) + "\n")


if __name__ == "__main__":
    main()
