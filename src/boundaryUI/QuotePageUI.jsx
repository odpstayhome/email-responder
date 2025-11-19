import React, { useRef, useState } from "react";
import "./style.css";
import { NavLink } from "react-router-dom";

 
export default function QuotePageUI(){
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [topText, setTopText] = useState("");
  const [bottomText, setBottomText] = useState("");
  const [staffName, setStaffName] = useState("");

  const openFilePicker = () => fileInputRef.current?.click();

  const [checks, setChecks] = useState({
    generate: false,
    quote: false,
    paidCourier: false,
    noQuote: false,
  });

  const handleCheckboxSubmit = (selected) => {
    console.log("Selected options:", selected);
    if (selected.includes("generate")) handleGenerateQuote();
    if (selected.includes("quote")) handleQuote();
    if (selected.includes("paidCourier")) handelPaidCourier();
    if (selected.includes("noQuote")) handelNoQuote();
  };

  const onFileChange = (e) => {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    // accept only PDFs
    const isPdf =
      file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (!isPdf) {
      setFileName("");
      setError("Please upload a PDF file (.pdf).");
      e.target.value = ""; // reset the input
      return;
    }
    setFileName(file.name);
  };

  const handleGenerateQuote = async () => {
    try {
      const fd = new FormData();
      if (fileInputRef.current?.files?.[0]) fd.append("file", fileInputRef.current.files[0]);
      fd.append("intent", "quote_payment");
      // fd.append("product", "namecards");
      fd.append("text", topText);
      fd.append("staffName", staffName);

      //const res = await fetch("http://localhost:3001/api/compose", { method: "POST", body: fd });
      // app.jsx for vercel
      //const res = await fetch("/api/compose", { method: "POST", body: fd });
      // for local deployment
      const res = await fetch("http://192.168.100.77:3001/api/compose", { method: "POST", body: fd});

      // read as text first so we can display error bodies too
      const raw = await res.text();

      if (!res.ok) {
        setBottomText(`(server ${res.status})\n\n${raw}`);
        return;
      }

      // try parse JSON
      let data = {};
      try { data = JSON.parse(raw); } catch { /* not JSON */ }

      setBottomText(data.html ?? raw ?? "(no html)");
    } catch (e) {
      setBottomText(`(client error) ${String(e)}`);
    }
  };

  const handleQuote = async () => {
   try {
      const fd = new FormData();
      if (fileInputRef.current?.files?.[0]) fd.append("file", fileInputRef.current.files[0]);
      fd.append("intent", "quote");
      // fd.append("product", "namecards");
      fd.append("text", topText);
      fd.append("staffName", staffName);

      //const res = await fetch("http://localhost:3001/api/compose", { method: "POST", body: fd });
      // app.jsx for vercel
      //const res = await fetch("/api/compose", { method: "POST", body: fd });
      // for local deployment
      const res = await fetch("http://192.168.100.77:3001/api/compose", { method: "POST", body: fd});

      // read as text first so we can display error bodies too
      const raw = await res.text();

      if (!res.ok) {
        setBottomText(`(server ${res.status})\n\n${raw}`);
        return;
      }

      // try parse JSON
      let data = {};
      try { data = JSON.parse(raw); } catch { /* not JSON */ }

      setBottomText(data.html ?? raw ?? "(no html)");
    } catch (e) {
      setBottomText(`(client error) ${String(e)}`);
    }
  };

  const handelNoQuote = async() => {
   try {
      const fd = new FormData();
      if (fileInputRef.current?.files?.[0]) fd.append("file", fileInputRef.current.files[0]);
      fd.append("intent", "no_quote");
      fd.append("product", "stickers");
      fd.append("text", topText);
      fd.append("staffName", staffName);

      //const res = await fetch("http://localhost:3001/api/compose", { method: "POST", body: fd });
      // app.jsx for vercel
      //const res = await fetch("/api/compose", { method: "POST", body: fd });
      // for local deployment
      const res = await fetch("http://192.168.100.77:3001/api/compose", { method: "POST", body: fd});

      // read as text first so we can display error bodies too
      const raw = await res.text();

      if (!res.ok) {
        setBottomText(`(server ${res.status})\n\n${raw}`);
        return;
      }

      // try parse JSON
      let data = {};
      try { data = JSON.parse(raw); } catch { /* not JSON */ }

      setBottomText(data.html ?? raw ?? "(no html)");
    } catch (e) {
      setBottomText(`(client error) ${String(e)}`);
    }
  };

  const handelPaidCourier = async () => {
    try {
        const fd = new FormData();
        if (fileInputRef.current?.files?.[0]) fd.append("file", fileInputRef.current.files[0]);
        fd.append("intent", "paid_courier");
        fd.append("text", topText);
        fd.append("staffName", staffName);

        //const res = await fetch("http://localhost:3001/api/compose", {method: "POST", body: fd });
        // app.jsx for vercel
        //const res = await fetch("/api/compose", { method: "POST", body: fd });
        // for local deployment
        const res = await fetch("http://192.168.100.77:3001/api/compose", { method: "POST", body: fd});

        // read as text first so we can display error bodies too
        const raw = await res.text();

        if (!res.ok) {
          setBottomText(`(server ${res.status})\n\n${raw}`);
          return;
        }

        // try parse JSON
        let data = {};
        try { data = JSON.parse(raw); } catch { /* not JSON */ }

        setBottomText(data.html ?? raw ?? "(no html)");
    } catch (e) {
      setBottomText(`(client error) ${String(e)}`);
    }
  };

  return (
    <div className="pageCenter">
    <div className="wrap">
        {/* Upload row */}
        <nav className="navbar">
        <ul className="navbar-list">
            {[
            { to: "/", label: "Templated reply", end: true },
            { to: "/others", label: "General enquiry" }
            ].map(({ to, label, end }) => (
            <li className="navbar-item" key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                      `navbar-link${isActive ? " is-active" : ""}`
                  }
                  >
                  {label}
                </NavLink>
            </li>
            ))}
        </ul>
        </nav>
        <div className="uploadRow">
        <button type="button" className="btn" onClick={openFilePicker}>
            Upload customer email (PDF)
        </button>

        <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={onFileChange}
            className="fileInput"
        />

        <span
            className={`fileName ${fileName ? "hasFile" : ""}`}
            title={fileName}
            aria-live="polite"
        >
            {fileName || ""}
        </span>
        </div>

        {error && <div className="error">{error}</div>}

        {/* Top text box */}
        <label className="srOnly" htmlFor="topText">
        text box
        </label>
        <div className="label">Editing material/size/quantity(eg. material is mirrorkote) or additional information about customer</div>
        <textarea
          id="topText"
          className="textbox"
          value={topText}
          onChange={(e) => setTopText(e.target.value)}
          placeholder=""
        />

        {/* Staff selector */}
        <div className= "staffSection">
          <label className="staffLabel" style={{ fontSize: 14 }}>
              Staff:&nbsp;
              <select
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8 }}
              >
              <option value="">— select —</option>
              <option value="Mihya">Mihya</option>
              <option value="Shafiqa">Shafiqa</option>
              <option value="Yana">Yana</option>
              <option value="Elaine">Elaine</option>
              <option value="Syaz">Syaz</option>
              </select>
          </label>
        </div>
        {/* Buttons row */}
        {/* <div className="buttonRow">
        <button type="button" className="btn" onClick={handleGenerateQuote}>
            Generate quote (GET $)
        </button>
        <button type="button" className="btn" onClick={handleQuote}>
            No quote
        </button>
        <button type="button" className="btn" onClick={handleQuote}>
            [Paid:Courier]
        </button> */}
        <div className="buttonRow">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // collect selected options
              const selected = Object.entries(checks)
                .filter(([_, value]) => value)
                .map(([key]) => key);
              handleCheckboxSubmit(selected);
            }}
            className="checkboxForm"
          >
            <label className="checkboxLabel">
              <input
                type="checkbox"
                checked={checks.generate}
                onChange={() =>
                  setChecks((prev) => ({ ...prev, generate: !prev.generate }))
                }
              />
              Generate payment quote for sticker and namecards (GET $)
            </label>

            <label className="checkboxLabel">
              <input
                type="checkbox"
                checked={checks.quote}
                onChange={() =>
                  setChecks((prev) => ({ ...prev, quote: !prev.quote }))
                }
              />
              Can quote for sticker and namecards (!Sticker/!Namecards)
            </label>

            <label className="checkboxLabel">
              <input
                type="checkbox"
                checked={checks.noQuote}
                onChange={() =>
                  setChecks((prev) => ({ ...prev, noQuote: !prev.noQuote }))
                }
              />
              Cannot quote for sticker (!Sticker no info cant quote)
            </label>

            <label className="checkboxLabel">
              <input
                type="checkbox"
                checked={checks.paidCourier}
                onChange={() =>
                  setChecks((prev) => ({ ...prev, paidCourier: !prev.paidCourier }))
                }
              />
              [Paid:Courier]
            </label>

            <button type="submit" className="btn submitBtn">
              Submit
            </button>
          </form>
        </div>

        {/* Bottom text box */}
        <div
            className="textbox bottomBox"
            style={{ background: "#fff", overflow: "auto" }}
            dangerouslySetInnerHTML={{ __html: bottomText }}
        />
    </div>
    </div>
  );
}