import sqlite3
import json

conn = sqlite3.connect('knowledge_base.db')
cursor = conn.cursor()

cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()
print("Tables:", tables)

for (table_name,) in tables:
    try:
        cursor.execute(f"PRAGMA table_info({table_name});")
        print(f"\nTable: {table_name}")
        print("Schema:", cursor.fetchall())
        cursor.execute(f"SELECT * FROM {table_name} LIMIT 1;")
        print("Sample:", cursor.fetchall())
    except Exception as e:
        print(f"Error querying {table_name}: {e}")

conn.close()
