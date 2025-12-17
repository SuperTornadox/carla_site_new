import Script from "next/script";
import { ReactNode } from "react";
import { getBlogFooterHtml, getBlogHeaderHtml } from "@/lib/blogFragments";

export default async function BlogLayout({ children }: { children: ReactNode }) {
  const headerHtml = await getBlogHeaderHtml();
  const footerHtml = await getBlogFooterHtml();

  return (
    <>
      <div id="page" className="hfeed site">
        <a className="skip-link screen-reader-text" href="#main">
          Skip to content
        </a>

        {headerHtml ? (
          <div dangerouslySetInnerHTML={{ __html: headerHtml }} />
        ) : null}

        <div id="main" className="clearfix">
          <div className="inner-wrap clearfix">
            <div id="primary">
              <div id="content" className="clearfix">
                {children}
              </div>
            </div>
          </div>
        </div>

        {footerHtml ? (
          <div dangerouslySetInnerHTML={{ __html: footerHtml }} />
        ) : null}

        <a href="#masthead" id="scroll-up">
          <i className="fa fa-chevron-up" />
        </a>
      </div>

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
    </>
  );
}
