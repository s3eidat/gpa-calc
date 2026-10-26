/* GPA Calc — credit-weighted averages; everything is stored on this device only. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var KEY = "gpa.v1";
  var SCALES = {
    "4.0": [["A", 4], ["A-", 3.7], ["B+", 3.3], ["B", 3], ["B-", 2.7], ["C+", 2.3], ["C", 2], ["C-", 1.7], ["D+", 1.3], ["D", 1], ["D-", 0.7], ["F", 0]],
    "4.3": [["A+", 4.3], ["A", 4], ["A-", 3.7], ["B+", 3.3], ["B", 3], ["B-", 2.7], ["C+", 2.3], ["C", 2], ["C-", 1.7], ["D+", 1.3], ["D", 1], ["D-", 0.7], ["F", 0]],
    "5.0": [["A+", 5], ["A", 4.75], ["B+", 4.5], ["B", 4], ["C+", 3.5], ["C", 3], ["D+", 2.5], ["D", 2], ["F", 1]]
  };

  function num(v) {
    v = String(v == null ? "" : v)
      .replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 0x660; })
      .replace(/[۰-۹]/g, function (d) { return d.charCodeAt(0) - 0x6F0; })
      .replace(/٫/g, ".").replace(/[,\s_٬]/g, "");
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v) ? parseFloat(v) : NaN;
  }

  // ---------- maths ----------
  function points(scale, letter) { var g = (SCALES[scale] || []).filter(function (x) { return x[0] === letter; })[0]; return g ? g[1] : NaN; }
  function bounds(s) { return s.scale === "pct" ? [s.pmin, s.pmax] : [SCALES[s.scale][SCALES[s.scale].length - 1][1], SCALES[s.scale][0][1]]; }
  // rows: [{credits, value}] → {credits, pts, gpa}
  function weighted(rows) {
    var cr = 0, pts = 0;
    rows.forEach(function (r) { if (r.credits > 0 && isFinite(r.value)) { cr += r.credits; pts += r.credits * r.value; } });
    return { credits: cr, pts: pts, gpa: cr ? pts / cr : NaN };
  }
  function cumulative(prevCr, prevGpa, sem) {
    var cr = (prevCr > 0 && isFinite(prevGpa) ? prevCr : 0) + sem.credits, pts = (prevCr > 0 && isFinite(prevGpa) ? prevCr * prevGpa : 0) + sem.pts;
    return { credits: cr, pts: pts, gpa: cr ? pts / cr : NaN };
  }
  function needed(cum, target, upcoming) { return upcoming > 0 ? (target * (cum.credits + upcoming) - cum.pts) / upcoming : NaN; }

  // ---------- state ----------
  function blank(id) { return { id: id, name: "", cr: "3", letter: "", mark: "" }; }
  var st = S3.store(KEY);
  if (!st || !Array.isArray(st.courses)) st = { scale: "4.0", pmin: "35", pmax: "100", courses: [blank(1), blank(2), blank(3), blank(4)], seq: 5, pcr: "", pgpa: "", tgt: "", rem: "15" };
  if (!SCALES[st.scale] && st.scale !== "pct") st.scale = "4.0";
  function save() { S3.store(KEY, st); }
  function scaleState() { return { scale: st.scale, pmin: num(st.pmin), pmax: num(st.pmax) }; }
  function valueOf(c) {
    if (st.scale !== "pct") return points(st.scale, c.letter);
    var m = num(c.mark), b = bounds(scaleState());
    return m >= b[0] && m <= b[1] ? m : NaN;
  }
  // toPrecision first so 2.675 rounds to 2.68 (2.675 * 100 is 267.4999… in binary floating point).
  function f2(v) { return isFinite(v) ? (Math.round(Number((v * 100).toPrecision(12))) / 100).toFixed(2) : "—"; }

  // ---------- courses UI ----------
  function drawCourses() {
    var box = $("#courses"); box.innerHTML = "";
    st.courses.forEach(function (c, i) {
      var name = S3.h("input", { "class": "input", value: c.name, placeholder: "Course " + (i + 1), "aria-label": "Course name", dir: "auto", maxlength: "60",
        oninput: function () { c.name = name.value; save(); } });
      var cr = S3.h("input", { "class": "input cr", value: c.cr, inputmode: "decimal", "aria-label": "Credit hours", oninput: function () { c.cr = cr.value; compute(); } });
      var grade;
      if (st.scale === "pct") {
        grade = S3.h("input", { "class": "input mk", value: c.mark, inputmode: "decimal", placeholder: "Mark", "aria-label": "Mark",
          oninput: function () { c.mark = grade.value; compute(); } });
      } else {
        grade = S3.h("select", { "class": "select", "aria-label": "Grade", onchange: function () { c.letter = grade.value; compute(); } });
        grade.appendChild(S3.h("option", { value: "", text: "—" }));
        SCALES[st.scale].forEach(function (g) { grade.appendChild(S3.h("option", { value: g[0], text: g[0] + "  (" + g[1] + ")" })); });
        grade.value = isFinite(points(st.scale, c.letter)) ? c.letter : "";
      }
      var del = S3.h("button", { type: "button", "class": "btn ghost icon", "aria-label": "Remove course", html: '<svg class="i"><use href="#i-x"/></svg>',
        onclick: function () { st.courses = st.courses.filter(function (x) { return x !== c; }); drawCourses(); compute(); } });
      box.appendChild(S3.h("div", { "class": "course" }, [name, cr, grade, del]));
    });
    if (!st.courses.length) box.appendChild(S3.h("div", { "class": "empty", text: "No courses yet. Add one to start." }));
  }

  function compute() {
    save();
    var ss = scaleState(), pct = st.scale === "pct", b = bounds(ss);
    $$("#courses .course").forEach(function (row, i) {
      var c = st.courses[i], m = row.querySelector(".mk");
      if (m) m.style.borderColor = c.mark.trim() && !isFinite(valueOf(c)) ? "var(--danger)" : "";
    });
    var sem = weighted(st.courses.map(function (c) { return { credits: num(c.cr), value: valueOf(c) }; }));
    var cum = cumulative(num(st.pcr), num(st.pgpa), sem);
    var unit = pct ? "%" : "";
    $("#sem").textContent = f2(sem.gpa) + (isFinite(sem.gpa) ? unit : "");
    $("#sem-sub").textContent = sem.credits ? sem.credits + " credits · " + (Math.round(sem.pts * 100) / 100) + " points" : "Add credits and grades";
    $("#cum").textContent = f2(cum.gpa) + (isFinite(cum.gpa) ? unit : "");
    $("#cum-sub").textContent = cum.credits ? cum.credits + " credits in total" : "";
    var pg = num(st.pgpa);
    $("#pgpa").style.borderColor = st.pgpa.trim() && !(pg >= b[0] - 1e-9 && pg <= b[1]) && !(pct && pg >= 0 && pg <= b[1]) ? "var(--danger)" : "";

    var need = $("#need"), tgt = num(st.tgt), rem = num(st.rem);
    need.className = "need";
    if (!(tgt > 0) || !(rem > 0) || !cum.credits) {
      need.textContent = "Enter a target and the credits you still have to take.";
    } else {
      var n = needed(cum, tgt, rem);
      if (n > b[1] + 1e-9) { need.className = "need bad"; need.innerHTML = "<b>Not reachable</b><br>You would need an average of " + S3.esc(f2(n)) + unit + " over " + rem + " credits, above the maximum " + b[1] + unit + "."; }
      else if (n <= b[0]) { need.className = "need ok"; need.innerHTML = "<b>Already safe</b><br>Even the lowest grade keeps you at or above " + S3.esc(f2(tgt)) + unit + "."; }
      else {
        var letter = pct ? "" : SCALES[st.scale].slice().reverse().filter(function (g) { return g[1] >= n - 1e-9; })[0];
        need.innerHTML = "You need an average of <b>" + S3.esc(f2(n)) + unit + "</b> over the next " + rem + " credits" +
          (letter ? " (about <b>" + S3.esc(letter[0]) + "</b> or better)" : "") + " to reach " + S3.esc(f2(tgt)) + unit + ".";
      }
    }
    st.text = "Semester GPA: " + f2(sem.gpa) + unit + " (" + sem.credits + " credits)\nCumulative GPA: " + f2(cum.gpa) + unit + " (" + cum.credits + " credits)" +
      (need.textContent && tgt > 0 && cum.credits ? "\n" + need.textContent : "");
  }

  function applyScale() {
    $("#scale").value = st.scale;
    $("#pct-range").hidden = st.scale !== "pct";
    $("#pmin").value = st.pmin; $("#pmax").value = st.pmax;
    $("#pgpa").placeholder = st.scale === "pct" ? "e.g. 78.5" : "e.g. 3.20";
    $("#tgt").placeholder = st.scale === "pct" ? "e.g. 80" : "e.g. 3.50";
    drawCourses(); compute();
  }

  // ---------- wiring ----------
  $("#scale").addEventListener("change", function () { st.scale = this.value; applyScale(); });
  $("#pmin").addEventListener("input", function () { st.pmin = this.value; compute(); });
  $("#pmax").addEventListener("input", function () { st.pmax = this.value; compute(); });
  ["pcr", "pgpa", "tgt", "rem"].forEach(function (k) { $("#" + k).value = st[k] || ""; $("#" + k).addEventListener("input", function () { st[k] = this.value; compute(); }); });
  $("#add").addEventListener("click", function () {
    if (st.courses.length >= 40) return S3.toast("40 courses max per semester", "error");
    st.courses.push(blank(st.seq++)); drawCourses(); compute();
    $$("#courses .course")[st.courses.length - 1].querySelector("input").focus();
  });
  $("#clear").addEventListener("click", function () { if (!window.confirm("Remove all courses from this semester?")) return; st.courses = [blank(st.seq++)]; drawCourses(); compute(); });
  $("#copy").addEventListener("click", function () {
    if (!st.text || !/\d/.test($("#sem").textContent + $("#cum").textContent)) return S3.toast("Add a course with a grade first", "error");
    S3.copy(st.text); S3.done();
  });
  applyScale();

  window.S3_DEMO = function () {
    st = { scale: "4.0", pmin: "35", pmax: "100", seq: 10, pcr: "64", pgpa: "3.21", tgt: "3.40", rem: "18", courses: [
      { id: 1, name: "Data Structures", cr: "3", letter: "A-", mark: "" }, { id: 2, name: "Linear Algebra", cr: "3", letter: "B+", mark: "" },
      { id: 3, name: "Physics II", cr: "4", letter: "B", mark: "" }, { id: 4, name: "Technical Writing", cr: "2", letter: "A", mark: "" },
      { id: 5, name: "Arabic Language", cr: "3", letter: "A", mark: "" }] };
    ["pcr", "pgpa", "tgt", "rem"].forEach(function (k) { $("#" + k).value = st[k]; });
    applyScale();
  };

  window.S3_SELFTEST = function () {
    var s = weighted([{ credits: 3, value: points("4.0", "A") }, { credits: 3, value: points("4.0", "B+") }, { credits: 4, value: points("4.0", "C") }]);
    var c = cumulative(30, 3.2, s), n = needed(c, 3.3, 15);
    var p = weighted([{ credits: 3, value: 90 }, { credits: 3, value: 75 }, { credits: 2, value: NaN }]);
    return Math.abs(s.gpa - 2.99) < 1e-9 && s.credits === 10 && f2(c.gpa) === "3.15" && c.credits === 40 && f2(n) === "3.71" &&
      p.gpa === 82.5 && p.credits === 6 && points("4.3", "A+") === 4.3 && points("5.0", "B") === 4 && isNaN(points("4.0", "A+")) &&
      isNaN(weighted([]).gpa) && f2(cumulative(0, NaN, s).gpa) === "2.99" && f2(2.675) === "2.68";
  };
})();
