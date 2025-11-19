//React component
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import React, { useRef, useState } from "react";
import QuotePage from './boundaryUI/QuotePageUI';
import OthersPage from './boundaryUI/OthersPageUI';

export default function App() {
  return (
    <Routes>
      <Route path="/" element = { <QuotePage /> } />
      <Route path="/others" element = { <OthersPage /> } />
    </Routes>
  );
}
