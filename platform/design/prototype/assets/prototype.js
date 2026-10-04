/* ============================================================================
   Лидеры права – 2027 · прототип
   Клиентская логика функциональных экранов. Без внешних зависимостей.
   ========================================================================== */
(function () {
  "use strict";

  var STORE = "lp2027:";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(STORE + key);
      window.localStorage.setItem(STORE + key, value);
    } catch (e) { /* приватный режим — прототип продолжает работать без памяти */ }
    return null;
  }

  /* Время по Москве, формат ЧЧ:ММ ---------------------------------------- */
  function mskTime(date) {
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow"
      }).format(date || new Date());
    } catch (e) {
      var d = date || new Date();
      return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    }
  }
  window.lpMskTime = mskTime;

  /* ------------------------------------------------ Смена оформления (токены) */
  (function theme() {
    var saved = store("theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    $$("[data-theme-switch]").forEach(function (btn) {
      var value = btn.getAttribute("data-theme-switch");
      btn.setAttribute("aria-pressed", String((document.documentElement.getAttribute("data-theme") || "brand") === value));
      btn.addEventListener("click", function () {
        if (value === "brand") document.documentElement.removeAttribute("data-theme");
        else document.documentElement.setAttribute("data-theme", value);
        store("theme", value === "brand" ? "" : value);
        $$("[data-theme-switch]").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-switch") === value));
        });
      });
    });
  })();

  /* --------------------------------------------------- Прототипные состояния */
  (function protoStates() {
    var groups = {};
    $$("[data-proto-set]").forEach(function (btn) {
      var group = btn.getAttribute("data-proto-group") || "state";
      groups[group] = true;
      btn.addEventListener("click", function () {
        var state = btn.getAttribute("data-proto-set");
        $$('[data-proto-set][data-proto-group="' + group + '"]').forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        document.body.setAttribute("data-" + group, state);
        apply();
      });
    });

    /* Блоки, зависящие от состояния: data-when-state / data-when-status */
    function apply() {
      ["state", "status"].forEach(function (group) {
        var value = document.body.getAttribute("data-" + group) || "";
        $$("[data-when-" + group + "]").forEach(function (el) {
          el.hidden = el.getAttribute("data-when-" + group) !== value;
        });
      });
    }
    /* Начальное состояние берём у нажатой кнопки группы */
    Object.keys(groups).forEach(function (group) {
      if (document.body.getAttribute("data-" + group)) return;
      var pressed = $('[data-proto-set][data-proto-group="' + group + '"][aria-pressed="true"]');
      if (pressed) document.body.setAttribute("data-" + group, pressed.getAttribute("data-proto-set"));
    });
    document.addEventListener("proto:state", apply);
    window.lpApplyProtoState = apply;
    apply();
  })();

  /* ============================================================== МАСТЕР /apply */
  (function wizard() {
    var form = $("[data-wizard]");
    if (!form) return;

    var steps = $$("[data-step]", form);
    var railItems = $$("[data-step-ref]");
    var currentLabel = $("[data-step-current]");
    var currentTotal = $("[data-step-total]");
    if (currentTotal) currentTotal.textContent = String(steps.length).padStart(2, "0");

    function show(index, focus) {
      index = Math.max(0, Math.min(steps.length - 1, index));
      steps.forEach(function (step, i) { step.hidden = i !== index; });
      railItems.forEach(function (item, i) {
        item.setAttribute("data-state", i === index ? "current" : (i < index ? "done" : "todo"));
        if (i === index) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
      });
      var fill = $("[data-step-fill]");
      if (fill) fill.style.width = ((index + 1) / steps.length) * 100 + "%";
      if (currentLabel) currentLabel.textContent = steps[index].getAttribute("data-step-title") || "";
      var num = $("[data-step-num]");
      if (num) num.textContent = "Шаг " + (index + 1) + " из " + steps.length;
      store("step", String(index));
      if (focus) {
        var heading = $("[data-step-heading]", steps[index]);
        if (heading) heading.focus();
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    }

    /* Навигация */
    $$("[data-wizard-next]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var index = Number(store("step") || 0);
        if (!validate(steps[index])) return;
        show(index + 1, true);
      });
    });
    $$("[data-wizard-back]").forEach(function (btn) {
      btn.addEventListener("click", function () { show(Number(store("step") || 0) - 1, true); });
    });
    railItems.forEach(function (item, i) {
      item.addEventListener("click", function (e) {
        var index = Number(store("step") || 0);
        if (i > index && !validate(steps[index])) { e.preventDefault(); return; }
        e.preventDefault();
        show(i, true);
      });
    });

    /* Проверка полей с видимыми подписями и текстом ошибки рядом с полем */
    function validate(step) {
      if (!step) return true;
      var ok = true;
      var first = null;
      $$("[data-required]", step).forEach(function (input) {
        var field = input.closest(".field, .check");
        var message = input.getAttribute("data-error") || "Заполните это поле.";
        if (input.type === "checkbox" ? !input.checked : !String(input.value).trim()) {
          ok = false;
          if (field) {
            field.setAttribute("data-invalid", "true");
            field.classList.add("check--invalid");
            input.setAttribute("aria-invalid", "true");
            if (!field.querySelector(".field__error")) {
              var err = document.createElement("p");
              err.className = "field__error";
              err.setAttribute("role", "alert");
              err.textContent = message;
              field.appendChild(err);
            }
          }
          if (!first) first = input;
        }
      });
      if (first) first.focus();
      return ok;
    }

    /* Снятие ошибки при исправлении */
    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field, .check");
      if (!field) return;
      field.removeAttribute("data-invalid");
      field.classList.remove("check--invalid");
      e.target.removeAttribute("aria-invalid");
      var err = field.querySelector(".field__error");
      if (err) err.remove();
    });

    /* Автосохранение черновика */
    var saveState = $("[data-savestate]");
    var saveText = $("[data-savestate-text]");
    var timer = null;
    function save() {
      if (!saveState || !saveText) return;
      saveState.setAttribute("data-state", "saving");
      saveText.textContent = "Сохранение черновика…";
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        saveState.setAttribute("data-state", "saved");
        saveText.textContent = "Черновик сохранён, " + mskTime() + " (МСК)";
        var meta = $("[data-saved-at]");
        if (meta) meta.textContent = mskTime() + " (МСК)";
      }, 900);
    }
    form.addEventListener("input", save);
    form.addEventListener("change", save);

    /* Перенос введённых значений в итоговую проверку */
    function fillReview() {
      $$("[data-review]", form).forEach(function (out) {
        var name = out.getAttribute("data-review");
        var input = form.querySelector('[name="' + name + '"]');
        if (!input) return;
        var value;
        if (input.type === "checkbox") value = input.checked ? "Подтверждено" : "Не подтверждено";
        else if (input.tagName === "SELECT") {
          var option = input.options[input.selectedIndex];
          value = option ? option.textContent.trim() : "";
        } else value = String(input.value).trim();
        if (!value) value = out.getAttribute("data-empty") || "— не заполнено —";
        out.textContent = value;
      });
    }

    /* Отправка */
    var submit = $("[data-wizard-submit]");
    if (submit) {
      submit.addEventListener("click", function (e) {
        e.preventDefault();
        var index = Number(store("step") || 0);
        if (!validate(steps[index])) return;
        var done = $("[data-sent]");
        if (done) {
          done.hidden = false;
          done.focus();
        }
        window.scrollTo({ top: 0, behavior: "auto" });
      });
    }

    /* Демонстрация загрузки файла */
    $$("[data-upload-sim]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var slot = btn.closest("[data-upload], .slot");
        if (!slot) return;
        var target = slot.querySelector("[data-upload]") || slot;
        if (target.hasAttribute("data-upload")) target.hidden = false;
        var fill = $(".bar__fill", slot);
        var status = $("[data-upload-status]", slot);
        var percent = $("[data-upload-percent]", slot);
        var file = btn.getAttribute("data-upload-file") || "Пояснительная записка.pdf";
        var startBtn = btn;
        startBtn.disabled = true;
        var p = 0;
        var tick = window.setInterval(function () {
          p += 4;
          if (fill) fill.style.width = p + "%";
          if (percent) percent.textContent = p + " %";
          if (status) status.textContent = "Загрузка файла «" + file + "» — " + p + " %. Не закрывайте страницу.";
          if (p >= 100) {
            window.clearInterval(tick);
            if (fill) fill.parentElement.setAttribute("aria-valuenow", "100");
            if (status) status.textContent = "Файл «" + file + "» загружен и ожидает технической проверки.";
            startBtn.disabled = false;
            var submit = $("[data-upload-submit]");
            if (submit) submit.disabled = false;
            save();
          }
        }, 90);
      });
    });

    show(Number(store("step") || 0), false);
    fillReview();
    form.addEventListener("input", fillReview);
    form.addEventListener("change", fillReview);
  })();

  /* ======================================================== ВХОД /cabinet/access */
  (function cabinetAccess() {
    var form = $("[data-access-form]");
    if (!form) return;
    var resend = $("[data-access-resend]");
    var sent = $("[data-access-sent]");

    /* Ошибки заполнения — текстом рядом с полем */
    function fail(input, message) {
      var field = input.closest(".field");
      field.setAttribute("data-invalid", "true");
      input.setAttribute("aria-invalid", "true");
      if (!field.querySelector(".field__error")) {
        var err = document.createElement("p");
        err.className = "field__error";
        err.setAttribute("role", "alert");
        err.textContent = message;
        field.appendChild(err);
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var number = $("#application-number");
      var email = $("#captain-email-access");
      var ok = true;
      if (!String(number.value).trim()) { fail(number, "Укажите номер заявки из письма Оргкомитета."); ok = false; }
      if (!String(email.value).trim()) { fail(email, "Укажите адрес электронной почты капитана команды."); ok = false; }
      if (!ok) { (String(number.value).trim() ? email : number).focus(); return; }
      if (document.body.getAttribute("data-state") === "error") {
        var banner = $('[data-when-state="error"]');
        if (banner) banner.focus();
        return;
      }
      if (sent) { sent.hidden = false; sent.focus(); }
    });

    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field");
      if (!field) return;
      field.removeAttribute("data-invalid");
      e.target.removeAttribute("aria-invalid");
      var err = field.querySelector(".field__error");
      if (err) err.remove();
    });

    if (resend) {
      resend.addEventListener("click", function (e) {
        e.preventDefault();
        if (sent) { sent.hidden = false; sent.focus(); }
      });
    }
  })();

  /* ============================================== АДМИНКА: список, фильтры, CSV */
  (function adminList() {
    var table = $("[data-admin-list]");
    if (!table) return;
    var rows = $$("tbody tr", table);
    var search = $("#admin-search");
    var status = $("#filter-status");
    var stage = $("#filter-stage");
    var onlyNotes = $("#filter-notes");
    var counter = $("[data-result-count]");
    var selection = $("[data-selection-count]");
    var empty = $("[data-empty-state]");
    var selectAll = $("[data-select-all]");

    function visibleRows() {
      return rows.filter(function (row) { return !row.hidden; });
    }
    function apply() {
      var q = (search && search.value || "").trim().toLowerCase();
      var st = status && status.value || "";
      var sg = stage && stage.value || "";
      var notes = onlyNotes && onlyNotes.checked;
      rows.forEach(function (row) {
        var haystack = row.textContent.toLowerCase();
        var ok = (!q || haystack.indexOf(q) !== -1) &&
          (!st || row.getAttribute("data-status") === st) &&
          (!sg || row.getAttribute("data-stage") === sg) &&
          (!notes || row.getAttribute("data-notes") === "yes");
        row.hidden = !ok;
      });
      if (counter) counter.textContent = "Найдено " + visibleRows().length + " из " + rows.length + " заявок";
      if (empty) empty.hidden = visibleRows().length !== 0;
      updateSelection();
    }
    function updateSelection() {
      var checked = visibleRows().filter(function (row) {
        var box = row.querySelector("input[type=checkbox]");
        return box && box.checked;
      });
      if (selection) {
        selection.textContent = checked.length
          ? "Выбрано заявок: " + checked.length
          : "Заявки не выбраны — выгрузка включает все отфильтрованные";
      }
      $$("[data-export-csv]").forEach(function (btn) {
        btn.textContent = checked.length ? "Выгрузить выбранные (" + checked.length + ")" : "Выгрузить CSV";
      });
    }

    [search, status, stage, onlyNotes].forEach(function (control) {
      if (!control) return;
      control.addEventListener(control.type === "text" ? "input" : "change", apply);
    });

    if (selectAll) {
      selectAll.addEventListener("change", function () {
        visibleRows().forEach(function (row) {
          var box = row.querySelector("input[type=checkbox]");
          if (box) box.checked = selectAll.checked;
        });
        updateSelection();
      });
    }
    table.addEventListener("change", function (e) {
      if (e.target.type === "checkbox") updateSelection();
    });

    /* Выгрузка CSV формируется на клиенте, без обращения к серверу */
    $$("[data-export-csv]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var selected = visibleRows().filter(function (row) {
          var box = row.querySelector("input[type=checkbox]");
          return box && box.checked;
        });
        var target = selected.length ? selected : visibleRows();
        var head = ["Номер заявки", "Команда", "Регион", "Направление", "Этап", "Статус", "Замечаний", "Срок досдачи"];
        var lines = [head.join(";")];
        target.forEach(function (row) {
          var cells = $$("td", row).slice(1)
            .filter(function (cell) { return cell.getAttribute("data-label") !== "Действие"; })
            .map(function (cell) {
              return '"' + cell.innerText.replace(/\s+/g, " ").replace(/"/g, '""').trim() + '"';
            });
          lines.push(cells.join(";"));
        });
        var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "zayavki-lidery-prava-2027.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    });

    var reset = $("[data-filter-reset]");
    if (reset) {
      reset.addEventListener("click", function () {
        if (search) search.value = "";
        if (status) status.value = "";
        if (stage) stage.value = "";
        if (onlyNotes) onlyNotes.checked = false;
        apply();
        if (search) search.focus();
      });
    }
    apply();
  })();

  /* ================================================ АДМИНКА: оценочный лист */
  (function evaluation() {
    var sheet = $("[data-evaluation]");
    if (!sheet) return;
    var inputs = $$("[data-score]", sheet);
    var total = $("[data-score-total]");
    var max = $("[data-score-max]");
    var verdict = $("[data-score-verdict]");
    var publish = $("[data-publish]");
    var confirmBox = $("[data-publish-confirm]");
    var protocolStatus = $("[data-protocol-status]");

    function recalc() {
      var sum = 0;
      var maxSum = 0;
      inputs.forEach(function (input) {
        var m = Number(input.getAttribute("data-max"));
        var v = input.value === "" ? 0 : Number(input.value);
        var field = input.closest(".field");
        maxSum += m;
        var over = v > m;
        if (field) {
          var err = field.querySelector(".field__error");
          if (over && !err) {
            err = document.createElement("p");
            err.className = "field__error";
            err.setAttribute("role", "alert");
            err.textContent = "Балл не может превышать максимум — " + m + ".";
            field.appendChild(err);
            input.setAttribute("aria-invalid", "true");
          } else if (!over && err) {
            err.remove();
            input.removeAttribute("aria-invalid");
          }
        }
        sum += over ? m : v;
      });
      if (total) total.textContent = String(sum);
      if (max) max.textContent = String(maxSum);
      if (verdict) {
        var share = maxSum ? sum / maxSum : 0;
        verdict.textContent = share >= 0.8 ? "Рекомендовать к участию в Первом этапе"
          : share >= 0.5 ? "Рекомендовать с замечаниями"
            : "Не рекомендовать";
      }
    }
    inputs.forEach(function (input) { input.addEventListener("input", recalc); });
    recalc();

    if (confirmBox && publish) {
      confirmBox.addEventListener("change", function () { publish.disabled = !confirmBox.checked; });
    }
    if (publish) {
      publish.addEventListener("click", function () {
        if (protocolStatus) {
          protocolStatus.className = "chip chip--ok";
          protocolStatus.innerHTML = '<span class="chip__mark" aria-hidden="true"></span>Опубликован';
        }
        var note = $("[data-protocol-note]");
        if (note) {
          note.hidden = false;
          note.textContent = "Протокол опубликован " + mskTime() + " (МСК) и доступен участникам в личных кабинетах.";
        }
        publish.disabled = true;
        if (confirmBox) confirmBox.disabled = true;
      });
    }
  })();

  /* ============================================ Прочие формы (без отправки) */
  $$("[data-noop]").forEach(function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); });
  });
})();
