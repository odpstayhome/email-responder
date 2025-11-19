//the entry script that renders your component into that div with createRoot(...).render(<App/>).
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.jsx";      // your component
import { BrowserRouter } from "react-router-dom";
console.log("main.jsx loaded");
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
