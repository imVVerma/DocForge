import React from "react";
import ReactDOM from "react-dom/client";
import { Route, Switch } from "wouter";
import { Toaster } from "sonner";

import { Layout } from "@/components/Layout";
import { LandingPage } from "@/pages/LandingPage";
import { ConvertPage } from "@/pages/ConvertPage";
import { MergePage } from "@/pages/MergePage";
import { CompressPage } from "@/pages/CompressPage";
import { OcrPage } from "@/pages/OcrPage";

import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Layout>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/convert" component={ConvertPage} />
        <Route path="/merge" component={MergePage} />
        <Route path="/compress" component={CompressPage} />
        <Route path="/ocr" component={OcrPage} />
        <Route>
          <div className="text-center py-20 text-[#6B6B65] dark:text-[#888880]">
            <p className="text-lg font-medium">Page not found</p>
            <a href="/" className="text-sm text-accent dark:text-accent-dark mt-2 block">
              Go home
            </a>
          </div>
        </Route>
      </Switch>
    </Layout>
    <Toaster position="bottom-right" richColors />
  </React.StrictMode>
);

