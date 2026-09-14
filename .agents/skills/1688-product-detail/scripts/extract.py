#!/usr/bin/env python3
"""Generate a read-only 1688 detail extractor for agent-browser eval."""

from __future__ import annotations

import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("offer_id")
    args = parser.parse_args()
    if not args.offer_id.strip():
        parser.error("offer_id is required")

    js = r'''(function () {
  const requestedId = __ID__;
  const empty = (status, warnings, sourceUrl, title, pageId) => ({
    platform: "1688",
    id: String(pageId || requestedId || "unknown"),
    title: title || null,
    sourceUrl: sourceUrl || String(location.href || ""),
    observedAt: new Date().toISOString(),
    shop: {name: null, companyName: null, url: null, metrics: null},
    price: {raw: null, amount: null, kind: "unknown", tiers: [], moq: {raw: null, amount: null}, unit: null, skuResolved: false},
    images: [],
    skuGroups: [],
    skuResolved: false,
    attributes: {},
    availabilityText: null,
    shippingText: null,
    promotions: [],
    platformData: {skuCount: null, naturalNetworkMetricsObserved: false},
    warnings: warnings || [],
    status
  });
  try {
    const sourceUrl = String(location.href || "");
    const bodyText = ((document.body && (document.body.innerText || document.body.textContent)) || "")
      .replace(/\s+/g, " ").trim();
    const warnings = ["sku_not_explicitly_resolved", "supplier_metrics_require_natural_network_observation"];
    const pageIdentity = `${String(document.title || "")} ${String(location.pathname || "")} ${sourceUrl}`;
    const hasAny = (patterns, text = bodyText) => patterns.some((pattern) => pattern.test(text) || pattern.test(sourceUrl));
    const detailTitleSelectors = '[data-title], [class*="d-title"], [class*="product-title"], h1';
    const hasStructuredTitle = Boolean(window.context && window.context.result && window.context.result.data
      && ((window.context.result.data.productTitle && window.context.result.data.productTitle.fields && window.context.result.data.productTitle.fields.title)
        || (window.context.result.data.Root && window.context.result.data.Root.fields && window.context.result.data.Root.fields.dataJson
          && window.context.result.data.Root.fields.dataJson.tempModel && window.context.result.data.Root.fields.dataJson.tempModel.offerTitle)));
    const hasDetailContent = () => hasStructuredTitle || Array.from(document.querySelectorAll(detailTitleSelectors)).some((node) => String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim());
    const statusHint = () => {
      const hasContent = hasDetailContent();
      if (hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i], pageIdentity)
        || (!hasContent && hasAny([/滑块/i, /验证码/i, /captcha/i, /安全验证/i, /风险验证/i, /人机验证/i]))) return "security_verification";
      if (hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i, /punish/i, /_____tmd_____/i], pageIdentity)
        || (!hasContent && hasAny([/异常流量/i, /访问受限/i, /禁止访问/i, /403\s*forbidden/i, /too many requests/i]))) return "site_blocked";
      if (!hasContent && hasAny([/请先登录/i, /请登录/i, /登录后/i, /扫码登录/i, /短信验证码/i, /账号确认/i, /登录可见/i])) return "authentication_required";
      if (!hasContent && hasAny([/商品不存在/i, /页面不存在/i, /找不到该商品/i, /抱歉/i])) return "no_results";
      return null;
    };
    const hint = statusHint();
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
      if (value === null || value === undefined || value === "") return null;
      const match = String(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    const priceInfo = (raw, kindOverride) => {
      const value = raw ? String(raw).replace(/\s+/g, " ").trim() : null;
      if (!value) return {raw: null, amount: null, kind: "unknown"};
      let kind = kindOverride || "displayed";
      if (!kindOverride && /面议|议价/.test(value)) kind = "negotiable";
      else if (!kindOverride && /\d\s*[-~至]\s*\d/.test(value)) kind = "range";
      else if (!kindOverride && /起|起批|低至/.test(value)) kind = "starting";
      return {raw: value, amount: numberFrom(value), kind};
    };
    const valueFrom = (value, keys) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "string" || typeof value === "number") return String(value);
      for (const key of keys) if (value[key] !== undefined && value[key] !== null) return String(value[key]);
      return null;
    };
    const ctx = window.context && window.context.result && window.context.result.data || {};
    const root = ctx.Root && ctx.Root.fields && ctx.Root.fields.dataJson || {};
    const tempModel = root.tempModel || {};
    const orderParamModel = root.orderParamModel || {};
    const productTitleFields = ctx.productTitle && ctx.productTitle.fields || {};
    let shopInfo = productTitleFields.shopInfo || {};
    if (typeof shopInfo === "string") { try { shopInfo = JSON.parse(shopInfo); } catch (_) { shopInfo = {}; } }
    let pageId = tempModel.offerId || requestedId;
    const urlMatch = sourceUrl.match(/(?:detail\.)?1688\.com\/offer\/(\d+)/i) || sourceUrl.match(/\/(\d{6,})\.html/i);
    try {
      const parsed = new URL(sourceUrl);
      pageId = parsed.searchParams.get("offerId") || (urlMatch && urlMatch[1]) || pageId;
    } catch (_) { if (urlMatch) pageId = urlMatch[1]; }
    if (hint) {
      warnings.unshift("status_hint:" + hint);
      return empty(hint, warnings, sourceUrl, null, pageId);
    }

    const titleNode = first(document, ['[data-title]', '[class*="d-title"]', '[class*="product-title"]', '[class*="title"]', "h1"]);
    const title = productTitleFields.title || tempModel.offerTitle || text(titleNode) || attr(document.querySelector('meta[property="og:title"]'), ["content"]);
    if (!title) {
      warnings.push("title_missing");
      return empty("no_results" === hint ? "no_results" : "layout_changed", warnings, sourceUrl, null, pageId);
    }
    if (String(requestedId) !== String(pageId)) {
      warnings.push("page_id_mismatch");
      return empty("layout_changed", warnings, sourceUrl, title, pageId);
    }

    const mainPriceFields = ctx.mainPrice && ctx.mainPrice.fields || {};
    const priceModel = mainPriceFields.priceModel || {};
    const finalPriceModel = mainPriceFields.finalPriceModel || {};
    const tradeData = finalPriceModel.tradeWithoutPromotion || {};
    const rawPrices = priceModel.currentPrices || priceModel.originalPrices || [];
    const tiers = rawPrices.map((price) => {
      const raw = valueFrom(price, ["price", "priceText", "value"]);
      return {minQty: price.beginAmount === undefined ? null : numberFrom(price.beginAmount), raw, amount: numberFrom(raw), kind: "tier"};
    }).filter((tier) => tier.raw || tier.amount !== null);
    const priceNode = first(document, ['[data-price]', '[class*="price"]', '[class*=Price]']);
    const domPriceRaw = attr(priceNode, ["data-price"]) || text(priceNode);
    const mainRaw = domPriceRaw || (tiers.length ? tiers.map((tier) => tier.raw).filter(Boolean).join(" - ") : null);
    const price = priceInfo(mainRaw, tiers.length > 1 ? "range" : (tiers.length === 1 ? "starting" : null));
    price.tiers = tiers;
    price.skuResolved = false;
    const unit = tempModel.offerUnit || attr(first(document, ['[data-unit]', '[class*="unit"]']), ["data-unit"]) || text(first(document, ['[data-unit]', '[class*="unit"]']));
    const moqNode = first(document, ['[data-moq]', '[class*="moq"]', '[class*="order"]', '[class*="起订"]']);
    const moqRaw = orderParamModel.beginNum !== undefined ? String(orderParamModel.beginNum) + (unit || "") : (attr(moqNode, ["data-moq"]) || text(moqNode) || ((bodyText.match(/(?:起订量|最小起订量|MOQ)[：:]?\s*[^，。；]{0,20}/i) || [])[0] || null));
    price.moq = {raw: moqRaw, amount: numberFrom(moqRaw)};
    price.unit = unit || null;

    const shopLink = first(document, ['[data-shop-url]', '[class*="shop"] a[href]', 'a[href*="1688.com"]']);
    const shopUrl = absolute(tempModel.winportUrl || attr(shopLink, ["href"]) || attr(first(document, ['[data-shop-url]']), ["data-shop-url"]));
    const shopName = shopInfo.shopName || shopInfo.companyName || tempModel.companyName || text(first(document, ['[data-shop-name]', '[class*="shopName"]', '[class*="company"]'])) || text(shopLink);
    const companyName = tempModel.companyName || shopInfo.companyName || shopInfo.authCompanyName || shopName;
    const shop = {
      name: shopName || null,
      companyName: companyName || null,
      url: shopUrl || null,
      sellerType: shopInfo.cardType || null,
      metrics: null
    };

    const seenImages = new Set();
    const images = [];
    const galleryFields = ctx.gallery && ctx.gallery.fields || {};
    const galleryValues = galleryFields.offerImgList || [];
    const imageValue = (value) => {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return null;
      for (const key of ["original", "originalUrl", "imageUrl", "url", "src", "imgUrl"]) if (value[key]) return String(value[key]);
      return null;
    };
    for (const value of galleryValues) {
      const url = absolute(imageValue(value));
      if (url && !seenImages.has(url)) { seenImages.add(url); images.push(url); }
    }
    for (const img of all(document, '[data-gallery] img, [class*="gallery"] img, [class*="Gallery"] img, img[data-image]')) {
      const url = absolute(attr(img, ["src", "data-src", "data-image", "data-original"]));
      if (url && !seenImages.has(url)) { seenImages.add(url); images.push(url); }
      if (images.length >= 30) break;
    }

    const skuMap = tradeData.skuMapOriginal || [];
    const skuGroups = [];
    const groupMap = {};
    const addOption = (name, label) => {
      if (!label) return;
      const groupName = name || "unknown";
      if (!groupMap[groupName]) { groupMap[groupName] = {name: groupName, options: []}; skuGroups.push(groupMap[groupName]); }
      if (!groupMap[groupName].options.some((option) => option.label === label)) groupMap[groupName].options.push({label, selected: false});
    };
    for (const sku of skuMap) {
      if (typeof sku.specAttrs === "string") sku.specAttrs.replace(/&gt;/g, ">").split(">").forEach((label, index) => addOption("sku" + (index + 1), label.trim()));
      else if (Array.isArray(sku.specAttrs)) sku.specAttrs.forEach((attrValue) => addOption(attrValue.attrName, attrValue.value));
    }
    for (const group of all(document, '[data-sku-group], [class*="skuGroup"], [class*="skuProperty"], [class*="skuItem"]')) {
      const name = attr(group, ["data-sku-name", "data-name"]) || text(first(group, ['[class*="name"]', '[class*="title"]', "dt", "label"])) || "unknown";
      const options = all(group, '[data-sku-option], [data-value], [class*="valueItem"], [class*="skuValue"], option')
        .map((option) => ({label: attr(option, ["data-sku-option", "data-value", "title"]) || text(option), selected: /selected|checked|current|active/i.test(String(option.className || "")) || option.getAttribute && option.getAttribute("aria-selected") === "true"}))
        .filter((option) => option.label);
      if (options.length) skuGroups.push({name, options});
    }

    const attributes = {};
    const addAttributes = (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const [key, item] of Object.entries(value)) {
        const rendered = valueFrom(item, ["value", "name", "text"]);
        if (rendered && rendered !== "[object Object]") attributes[String(key)] = rendered;
      }
    };
    addAttributes(root.productAttributes);
    addAttributes(root.offerProperties);
    addAttributes(ctx.productAttributes && ctx.productAttributes.fields);
    for (const row of all(document, '[data-attribute-row], table tr, [class*="attribute"] li, [class*="attribute"] [class*="row"]')) {
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
    const discountFields = ctx.discountCoupon && ctx.discountCoupon.fields || {};
    const couponList = discountFields.couponList || [];
    for (const coupon of couponList) {
      const value = valueFrom(coupon, ["couponContent", "content", "label", "name"]);
      if (value) promotions.push(value);
    }
    const seenPromotions = new Set(promotions);
    for (const node of all(document, '[data-promotion], [class*="promotion"], [class*="Promotion"], [class*="coupon"], [class*="优惠"]')) {
      const value = attr(node, ["data-promotion"]) || text(node);
      if (value && !seenPromotions.has(value)) { seenPromotions.add(value); promotions.push(value); }
      if (promotions.length >= 20) break;
    }
    return {
      platform: "1688",
      id: String(pageId || requestedId || "unknown"),
      title,
      sourceUrl,
      observedAt: new Date().toISOString(),
      shop,
      price,
      images,
      skuGroups,
      skuResolved: false,
      attributes,
      availabilityText,
      shippingText,
      promotions,
      platformData: {
        offerId: String(pageId || requestedId || "unknown"),
        skuCount: skuMap.length || null,
        naturalNetworkMetricsObserved: false,
        unit: unit || null,
        moq: price.moq,
        tieredPrices: tiers
      },
      warnings,
      status: "ok"
    };
  } catch (error) {
    return empty("layout_changed", ["extract_error:" + String(error && error.message || error)], String(location && location.href || ""), null, requestedId);
  }
})()'''
    sys.stdout.write(js.replace("__ID__", json.dumps(args.offer_id, ensure_ascii=False)) + "\n")


if __name__ == "__main__":
    main()
