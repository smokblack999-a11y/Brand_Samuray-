#!/usr/bin/env python3
"""Samurai Wisdom CRM Ultimate — single-file, standard-library CLI.

Safe-by-default local CRM and revenue ledger. No network calls are made.
Telegram integration is intentionally configuration/status-only until a real
Telegram Business webhook/client is wired in and tested.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

APP_NAME = "Samurai Wisdom CRM Ultimate"
DEFAULT_HOME = Path(os.environ.get("SAMURAI_HOME", Path.home() / ".samurai-wisdom"))
DB_NAME = "samurai_wisdom.sqlite3"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def open_db(home: Path = DEFAULT_HOME) -> sqlite3.Connection:
    home.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(home / DB_NAME), timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=10000")
    initialize(db)
    return db


def initialize(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new'
        CHECK(status IN ('new','contacted','qualified','won','lost')),
      expected_kzt INTEGER NOT NULL DEFAULT 0 CHECK(expected_kzt >= 0),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
      amount_kzt INTEGER NOT NULL CHECK(amount_kzt > 0),
      category TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_revenue_created ON revenue_entries(created_at);
    """)
    db.commit()


def audit(db: sqlite3.Connection, action: str, details: dict) -> None:
    db.execute("INSERT INTO audit_log(action,details,created_at) VALUES(?,?,?)",
               (action, json.dumps(details, ensure_ascii=False, sort_keys=True), utc_now()))


def add_lead(db: sqlite3.Connection, name: str, company: str = "",
             contact: str = "", expected_kzt: int = 0, notes: str = "") -> int:
    name = name.strip()
    if not name:
        raise ValueError("Имя лида обязательно.")
    if expected_kzt < 0:
        raise ValueError("Ожидаемая сумма не может быть отрицательной.")
    cur = db.execute(
        "INSERT INTO leads(name,company,contact,expected_kzt,notes,created_at) VALUES(?,?,?,?,?,?)",
        (name, company.strip(), contact.strip(), expected_kzt, notes.strip(), utc_now()))
    lead_id = int(cur.lastrowid)
    try:
        audit(db, "lead.created", {"id": lead_id, "name": name, "expected_kzt": expected_kzt})
        db.commit()
    except sqlite3.Error:
        db.rollback()
        raise
    return lead_id


def set_lead_status(db: sqlite3.Connection, lead_id: int, status: str) -> None:
    allowed = {"new", "contacted", "qualified", "won", "lost"}
    if status not in allowed:
        raise ValueError("Статус: new, contacted, qualified, won или lost.")
    cur = db.execute("UPDATE leads SET status=? WHERE id=?", (status, lead_id))
    if cur.rowcount != 1:
        db.rollback()
        raise ValueError(f"Лид #{lead_id} не найден.")
    try:
        audit(db, "lead.status_changed", {"id": lead_id, "status": status})
        db.commit()
    except sqlite3.Error:
        db.rollback()
        raise


def add_revenue_entry(db: sqlite3.Connection, kind: str, amount_kzt: int,
                      category: str, note: str = "") -> int:
    if kind not in {"income", "expense"}:
        raise ValueError("Тип должен быть income или expense.")
    if not isinstance(amount_kzt, int) or amount_kzt <= 0:
        raise ValueError("Сумма должна быть положительным целым числом в KZT.")
    category = category.strip()
    if not category:
        raise ValueError("Категория обязательна.")
    cur = db.execute(
        "INSERT INTO revenue_entries(kind,amount_kzt,category,note,created_at) VALUES(?,?,?,?,?)",
        (kind, amount_kzt, category, note.strip(), utc_now()))
    entry_id = int(cur.lastrowid)
    try:
        audit(db, "revenue.recorded", {"id": entry_id, "kind": kind,
                                       "amount_kzt": amount_kzt, "category": category})
        db.commit()
    except sqlite3.Error:
        db.rollback()
        raise
    return entry_id


def dashboard(db: sqlite3.Connection) -> dict:
    lead_counts = {row["status"]: row["n"] for row in db.execute(
        "SELECT status,COUNT(*) AS n FROM leads GROUP BY status")}
    sums = {row["kind"]: row["total"] for row in db.execute(
        "SELECT kind,COALESCE(SUM(amount_kzt),0) AS total FROM revenue_entries GROUP BY kind")}
    pipeline = db.execute(
        "SELECT COALESCE(SUM(expected_kzt),0) FROM leads WHERE status IN ('new','contacted','qualified')"
    ).fetchone()[0]
    income, expense = sums.get("income", 0), sums.get("expense", 0)
    return {"leads_total": sum(lead_counts.values()), "leads_by_status": lead_counts,
            "pipeline_kzt": pipeline, "income_kzt": income, "expense_kzt": expense,
            "net_kzt": income - expense}


def format_money(value: int) -> str:
    return f"{value:,}".replace(",", " ") + " KZT"


def print_dashboard(db: sqlite3.Connection) -> None:
    d = dashboard(db)
    print(f"\n{APP_NAME} — ОБЗОР")
    print("-" * 42)
    print(f"Лиды: {d['leads_total']} | Активная воронка: {format_money(d['pipeline_kzt'])}")
    print(f"Доход: {format_money(d['income_kzt'])}")
    print(f"Расход: {format_money(d['expense_kzt'])}")
    print(f"Финансовый результат по внесённым записям: {format_money(d['net_kzt'])}")
    print("Статусы:", ", ".join(f"{k}={v}" for k, v in sorted(d["leads_by_status"].items())) or "пока нет")


def list_leads(db: sqlite3.Connection) -> None:
    rows = db.execute("SELECT * FROM leads ORDER BY id DESC LIMIT 100").fetchall()
    if not rows:
        print("Лидов пока нет.")
        return
    print("\nID | Статус | Имя | Компания | Ожидаемо KZT | Контакт")
    for r in rows:
        print(f"{r['id']} | {r['status']} | {r['name']} | {r['company']} | "
              f"{format_money(r['expected_kzt'])} | {r['contact']}")


def list_revenue(db: sqlite3.Connection) -> None:
    rows = db.execute("SELECT * FROM revenue_entries ORDER BY id DESC LIMIT 100").fetchall()
    if not rows:
        print("Финансовых записей пока нет.")
        return
    print("\nID | Тип | Сумма | Категория | Дата UTC | Примечание")
    for r in rows:
        print(f"{r['id']} | {r['kind']} | {format_money(r['amount_kzt'])} | "
              f"{r['category']} | {r['created_at']} | {r['note']}")


def telegram_status() -> None:
    token_present = bool(os.environ.get("TELEGRAM_BOT_TOKEN"))
    business_mode = bool(os.environ.get("TELEGRAM_BUSINESS_CONNECTION_ID"))
    print("Telegram: статус конфигурации")
    print(f"TELEGRAM_BOT_TOKEN: {'установлен (значение скрыто)' if token_present else 'не установлен'}")
    print(f"TELEGRAM_BUSINESS_CONNECTION_ID: {'установлен' if business_mode else 'не установлен'}")
    print("Сетевые запросы не выполняются. Эта сборка не отправляет сообщения и не принимает webhook.")


def backup_db(db: sqlite3.Connection, home: Path = DEFAULT_HOME) -> Path:
    backup_dir = home / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"samurai-wisdom-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.sqlite3"
    with sqlite3.connect(str(target)) as dst:
        db.backup(dst)
    try:
        audit(db, "backup.created", {"path": str(target)})
        db.commit()
    except sqlite3.Error:
        db.rollback()
        raise
    return target


def self_test() -> bool:
    class CoreTests(unittest.TestCase):
        def setUp(self):
            self.tmp = tempfile.TemporaryDirectory()
            self.home = Path(self.tmp.name)
            self.db = open_db(self.home)

        def tearDown(self):
            self.db.close()
            self.tmp.cleanup()

        def test_initialization_is_idempotent(self):
            initialize(self.db)
            self.assertEqual(self.db.execute("SELECT COUNT(*) FROM leads").fetchone()[0], 0)

        def test_lead_and_status(self):
            lid = add_lead(self.db, "Test client", "Example Ltd", expected_kzt=120000)
            set_lead_status(self.db, lid, "qualified")
            self.assertEqual(self.db.execute("SELECT status FROM leads WHERE id=?", (lid,)).fetchone()[0], "qualified")
            self.assertEqual(dashboard(self.db)["pipeline_kzt"], 120000)

        def test_revenue_net(self):
            add_revenue_entry(self.db, "income", 10000, "pilot")
            add_revenue_entry(self.db, "expense", 2500, "hosting")
            self.assertEqual(dashboard(self.db)["net_kzt"], 7500)

        def test_invalid_inputs_fail_closed(self):
            with self.assertRaises(ValueError):
                add_lead(self.db, " ")
            with self.assertRaises(ValueError):
                add_revenue_entry(self.db, "income", -1, "test")
            with self.assertRaises(ValueError):
                set_lead_status(self.db, 999, "won")

        def test_audit_written(self):
            add_lead(self.db, "Audit test")
            self.assertGreater(self.db.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0], 0)

        def test_mutation_rolls_back_if_audit_fails(self):
            self.db.execute("""
                CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log
                BEGIN SELECT RAISE(ABORT, 'audit blocked'); END;
            """)
            self.db.commit()
            with self.assertRaises(sqlite3.Error):
                add_lead(self.db, "Must roll back")
            self.assertEqual(self.db.execute("SELECT COUNT(*) FROM leads").fetchone()[0], 0)

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CoreTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return result.wasSuccessful()


def prompt_int(label: str, minimum: int = 0) -> int:
    raw = input(label).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("Введите целое число.") from exc
    if value < minimum:
        raise ValueError(f"Число должно быть не меньше {minimum}.")
    return value


def run_menu(home: Path = DEFAULT_HOME) -> int:
    db = open_db(home)
    try:
        print(f"{APP_NAME}\nДанные: {home}\n")
        while True:
            print("\n1. Dashboard\n2. Добавить лид\n3. Список лидов\n4. Изменить статус лида")
            print("5. Записать доход/расход\n6. Финансовые записи\n7. Telegram — статус")
            print("8. Audit Log\n9. Backup\n10. Self-Test\n0. Выход")
            choice = input("> ").strip()
            try:
                if choice == "1":
                    print_dashboard(db)
                elif choice == "2":
                    name = input("Имя/название лида: ")
                    company = input("Компания: ")
                    contact = input("Контакт (без секретов): ")
                    amount = prompt_int("Ожидаемая сумма KZT [0]: ")
                    notes = input("Заметки: ")
                    print(f"Создан лид #{add_lead(db, name, company, contact, amount, notes)}")
                elif choice == "3":
                    list_leads(db)
                elif choice == "4":
                    lid = prompt_int("ID лида: ", 1)
                    status = input("Статус (new/contacted/qualified/won/lost): ").strip()
                    set_lead_status(db, lid, status)
                    print("Статус обновлён.")
                elif choice == "5":
                    kind = input("Тип (income/expense): ").strip()
                    amount = prompt_int("Сумма KZT: ", 1)
                    category = input("Категория: ")
                    note = input("Примечание: ")
                    print(f"Запись #{add_revenue_entry(db, kind, amount, category, note)} сохранена.")
                elif choice == "6":
                    list_revenue(db)
                elif choice == "7":
                    telegram_status()
                elif choice == "8":
                    for r in db.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 50"):
                        print(f"#{r['id']} {r['created_at']} {r['action']} {r['details']}")
                elif choice == "9":
                    print(f"Backup создан: {backup_db(db, home)}")
                elif choice == "10":
                    print("SELF-TEST:", "PASS" if self_test() else "FAIL")
                elif choice == "0":
                    return 0
                else:
                    print("Неизвестный пункт меню.")
            except (ValueError, sqlite3.Error, OSError) as exc:
                print(f"ОШИБКА: {exc}", file=sys.stderr)
    except (EOFError, KeyboardInterrupt):
        print("\nВыход.")
        return 0
    finally:
        db.close()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME,
                        help="папка данных (или переменная SAMURAI_HOME)")
    parser.add_argument("--self-test", action="store_true", help="запустить автоматические тесты")
    parser.add_argument("--dashboard", action="store_true", help="показать обзор и выйти")
    args = parser.parse_args(argv)
    if args.self_test:
        return 0 if self_test() else 1
    if args.dashboard:
        db = open_db(args.home)
        try:
            print_dashboard(db)
        finally:
            db.close()
        return 0
    return run_menu(args.home)


if __name__ == "__main__":
    raise SystemExit(main())
