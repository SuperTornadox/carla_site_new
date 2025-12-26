import Script from "next/script";
import { ReactNode } from "react";
import { getBlogFooterHtml, getBlogHeaderHtml } from "@/lib/blogFragments";
import HtmlContent from "./HtmlContent";
import "./blog.css";

export default async function BlogLayout({ children }: { children: ReactNode }) {
  const headerHtml = await getBlogHeaderHtml();
  const footerHtml = await getBlogFooterHtml();

  return (
    <>
      <div id="page" className="hfeed site" suppressHydrationWarning>
        <a className="skip-link screen-reader-text" href="#main">
          Skip to content
        </a>

        {headerHtml ? <HtmlContent html={headerHtml} /> : null}

        <div id="main" className="clearfix" suppressHydrationWarning>
          <div className="inner-wrap clearfix" suppressHydrationWarning>
            <div id="primary" suppressHydrationWarning>
              <div id="content" className="clearfix" suppressHydrationWarning>
                {children}
              </div>
            </div>
          </div>
        </div>

        {footerHtml ? <HtmlContent html={footerHtml} /> : null}

        <a href="#masthead" id="scroll-up">
          <i className="fa fa-chevron-up" />
        </a>
      </div>

      <Script
        id="blog-nav-active"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
(function () {
  function normPath(p) {
    if (!p) return "/";
    var out = p.split("#")[0].split("?")[0] || "/";
    if (!out.startsWith("/")) out = "/" + out;
    if (!out.endsWith("/")) out = out + "/";
    return out;
  }

  function toPathFromHref(href) {
    try {
      var u = new URL(href, location.origin);
      return normPath(u.pathname);
    } catch {
      return null;
    }
  }

  var menu = document.getElementById("menu-main-nav-menu");
  if (!menu) return;

  var current = normPath(location.pathname);
  var clearClasses = [
    "current-menu-item",
    "current_page_item",
    "current-menu-ancestor",
    "current_page_ancestor",
    "current-menu-parent",
    "current_page_parent",
  ];

  menu.querySelectorAll("li").forEach(function (li) {
    clearClasses.forEach(function (c) {
      li.classList.remove(c);
    });
  });
  menu.querySelectorAll("a[aria-current]").forEach(function (a) {
    a.removeAttribute("aria-current");
  });

  var best = null;
  var bestAnchor = null;
  var bestLen = -1;
  var anchors = Array.from(menu.querySelectorAll("a"));
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    var p = toPathFromHref(a.getAttribute("href") || "");
    if (!p) continue;
    if (p === current) {
      best = a.closest("li");
      bestAnchor = a;
      bestLen = p.length;
      break;
    }
    // Heuristic: if no exact match exists (e.g. a page not in the menu),
    // select the longest menu path that prefixes the current path.
    if (current.startsWith(p) && p.length > bestLen) {
      // Avoid always selecting "/" unless nothing else matches.
      if (p === "/" && bestLen >= 0) continue;
      best = a.closest("li");
      bestAnchor = a;
      bestLen = p.length;
    }
  }

  if (!best) {
    return;
  }

  best.classList.add("current-menu-item", "current_page_item");
  if (bestAnchor) bestAnchor.setAttribute("aria-current", "page");

  var parent = best.parentElement;
  while (parent && parent !== menu) {
    if (parent.tagName && parent.tagName.toLowerCase() === "ul") {
      var owner = parent.closest("li");
      if (owner) {
        owner.classList.add("current-menu-ancestor", "current-menu-parent");
        parent = owner.parentElement;
        continue;
      }
    }
    parent = parent.parentElement;
  }
})();`,
        }}
      />

      <Script
        src="/blog/wp-includes/js/jquery/jquery.min.js"
        strategy="beforeInteractive"
      />
      <Script
        src="/blog/wp-includes/js/jquery/jquery-migrate.min.js"
        strategy="beforeInteractive"
      />
      <Script
        src="/blog/wp-content/themes/freedom-pro/js/freedom-custom.min.js"
        strategy="afterInteractive"
      />

      <Script
        src="/blog/wp-content/themes/freedom-pro/js/navigation.min.js"
        strategy="afterInteractive"
      />
      <Script
        src="/blog/wp-content/themes/freedom-pro/js/skip-link-focus-fix.js"
        strategy="afterInteractive"
      />
      <Script
        src="/blog/wp-content/themes/freedom-pro/js/theia-sticky-sidebar/theia-sticky-sidebar.min.js"
        strategy="afterInteractive"
      />
      <Script
        src="/blog/wp-content/themes/freedom-pro/js/theia-sticky-sidebar/ResizeSensor.min.js"
        strategy="afterInteractive"
      />

      {/* Google Model Viewer for 3D content */}
      <Script
        src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"
        type="module"
        strategy="afterInteractive"
      />
    </>
  );
}
