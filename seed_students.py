import os
import pandas as pd

# 1. Locate CSV file
csv_path = "database/students.csv"
if not os.path.exists(csv_path):
    csv_path = "Final registered students for placement cycle 2027 - Sheet1.csv"

print(f"Reading CSV from: {csv_path}")
df = pd.read_csv(csv_path)

# 2. Define Discipline Mapping
disp_mapping = {
    "AI": "Artificial Intelligence",
    "CL": "Chemical",
    "CE": "Civil",
    "ME": "Mechanical",
    "CSE": "Computer Science",
    "EE": "Electrical",
    "HSS": "Humanities and Social Sciences",
    "CG": "Cognitive and Brain Sciences",
    "CH": "Chemistry",
    "MA": "Mathematics",
    "PH": "Physics",
    "BE": "Biological Sciences and Engineering",
    "ESS": "Earth Sciences",
    "ICDT": "Integrated Circuit Design & Technology",
    "MSE": "Materials",
}

# Find correct programme column name
prog_col = [c for c in df.columns if "Prog." in c]
prog_col_name = prog_col[0] if prog_col else "Prog."

# 3. Clean and Extract Columns
cleaned_df = pd.DataFrame(
    {
        "roll_number": df["Roll No"].astype(str).str.strip(),
        "name": df["Name of the Student"].astype(str).str.strip(),
        "email": df["Email ID"].astype(str).str.strip().str.lower(),
        "programme": df[prog_col_name].astype(str).str.strip(),
        "discipline": df["Disp."].astype(str).str.strip().map(lambda x: disp_mapping.get(str(x).strip(), str(x).strip())),
    }
)

# Filter out rows with invalid or empty emails/rolls if any
cleaned_df = cleaned_df.dropna(subset=["email", "roll_number"])

# 4. Generate MySQL Seed Statements (seed_students.sql)
with open("seed_students.sql", "w", encoding="utf-8") as f:
    f.write("-- Auto-generated student authorization seed file for MySQL\n")
    f.write("USE `cds_portal`;\n\n")
    for _, row in cleaned_df.iterrows():
        name_escaped = row['name'].replace("'", "''")
        prog_escaped = row['programme'].replace("'", "''")
        disp_escaped = row['discipline'].replace("'", "''")
        f.write(
            f"INSERT INTO allowed_students (roll_number, name, email, programme, discipline) "
            f"VALUES ('{row['roll_number']}', '{name_escaped}', '{row['email']}', '{prog_escaped}', '{disp_escaped}') "
            f"ON DUPLICATE KEY UPDATE name = VALUES(name), programme = VALUES(programme), discipline = VALUES(discipline);\n"
        )

print(f"✅ Successfully generated seed_students.sql with {len(cleaned_df)} records.")
