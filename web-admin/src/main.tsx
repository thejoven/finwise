import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { Toaster } from "@/components/ui/toaster";
import { FocusedUserProvider } from "@/lib/focusedUser";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <FocusedUserProvider>
          <Toaster>
            <App />
          </Toaster>
        </FocusedUserProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
