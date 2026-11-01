import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth";
import { ThemeProvider } from "./theme";
import BusyOverlay from "./ui/BusyOverlay";
import { ToastProvider } from "./ui/Toast";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
 <React.StrictMode>
 <ThemeProvider>
 <AuthProvider>
 <BrowserRouter>
 <ToastProvider>
 <App />
 <BusyOverlay />
 </ToastProvider>
 </BrowserRouter>
 </AuthProvider>
 </ThemeProvider>
 </React.StrictMode>
);
