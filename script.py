from pathlib import Path
text = Path('src/app/pages/LongTermForecasting_Demand.tsx').read_text().splitlines()
for i,line in enumerate(text):
    if 'scenarioComparisonData' in line:
        start = max(0, i-10)
        end = min(len(text), i+40)
        for j in range(start, end):
            print(f"{j+1}: {text[j]}")
        break
