import React, { useRef, useState } from "react";
import "./style.css";
import { NavLink } from "react-router-dom";

export default function OthersPageUI(){
      const fileInputRef = useRef(null);
      const [fileName, setFileName] = useState("");
      const [error, setError] = useState("");
      const [bottomText, setBottomText] = useState("");
      const [staffName, setStaffName] = useState("");
      const [styleNotes, setStyleNotes] = useState("");
    
      const openFilePicker = () => fileInputRef.current?.click();
    
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
    
      const handleOthers = async () => {
       try {
          const fd = new FormData();
          if (fileInputRef.current?.files?.[0]) fd.append("file", fileInputRef.current.files[0]);
          fd.append("intent", "general");
          // fd.append("product", "namecards");
          fd.append("staffName", staffName);
          // app.jsx (when building FormData in each handler)
          fd.append("styleNotes", styleNotes || "");
    
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

            <div className="label">Additional information on how to reply the customer</div>
            <textarea
                id="syleNotes"
                className="textbox"
                value={styleNotes}
                onChange={(e) => setStyleNotes(e.target.value)}
                placeholder=""
            />

            {/* Buttons row */}
            <div className="buttonRow">
            <button type="button" className="btn" onClick={handleOthers}>
                Submit
            </button>

            <label style={{ fontSize: 14 }}>
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