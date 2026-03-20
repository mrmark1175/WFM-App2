import csv
from datetime import datetime, timedelta
import random

def generate_mock_csv(filename):
    start_date = datetime(2024, 1, 1, 0, 0)
    end_date = datetime(2025, 12, 31, 23, 30)
    
    headers = [
        "Interval Start", "Interval End", "Interval Complete", "Filters", 
        "Media Type", "Queue Id", "Queue Name", "Offer", "Answer", 
        "Answer %", "Abandon", "Abandon %", "ASA", "Service Level %", 
        "Service Level Target %", "Avg Wait", "Avg Handle", "Avg Talk", 
        "Avg Hold", "Avg ACW", "Hold", "Transfer", "Short Abandon"
    ]

    queue_id = "b14113c6-caf4-491c-815e-1b89bb25c6b2; 61249553-e73c-4731-a085-f44dc6817d69"
    queue_name = "Vodafone DA; 1223"

    with open(filename, mode='w', newline='') as file:
        writer = csv.writer(file, quoting=csv.QUOTE_ALL)
        writer.writerow(headers)
        
        curr = start_date
        while curr <= end_date:
            interval_end = curr + timedelta(minutes=30)
            
            # Simple volume pattern: peaks around 10am and 2pm, low at night
            hour = curr.hour
            if 8 <= hour <= 18:
                base_offer = random.randint(20, 50)
            elif 0 <= hour <= 5:
                base_offer = random.randint(0, 5)
            else:
                base_offer = random.randint(5, 20)
            
            if base_offer > 0:
                offer = base_offer
                abandon = random.randint(0, int(offer * 0.1))
                answer = offer - abandon
                answer_pct = answer / offer
                abandon_pct = abandon / offer if offer > 0 else 0
                
                asa = random.uniform(1000, 15000) # 1-15 seconds in ms
                sl = 1.0 if asa < 20000 else 0.8
                
                avg_talk = random.uniform(180000, 400000) # 3-6 mins
                avg_acw = random.uniform(30000, 90000)   # 30-90s
                avg_handle = avg_talk + avg_acw
                
                row = [
                    curr.strftime("%m/%d/%y %I:%M %p"),
                    interval_end.strftime("%m/%d/%y %I:%M %p"),
                    "TRUE", "", "voice", queue_id, queue_name,
                    offer, answer, round(answer_pct, 4), 
                    abandon if abandon > 0 else "", 
                    round(abandon_pct, 4) if abandon > 0 else "",
                    round(asa, 2), round(sl, 2), "0.8",
                    round(asa, 2), round(avg_handle, 2), round(avg_talk, 2),
                    "", round(avg_acw, 2), "", "", ""
                ]
            else:
                row = [
                    curr.strftime("%m/%d/%y %I:%M %p"),
                    interval_end.strftime("%m/%d/%y %I:%M %p"),
                    "TRUE", "", "voice", queue_id, queue_name,
                    "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""
                ]
                
            writer.writerow(row)
            curr += timedelta(minutes=30)

if __name__ == "__main__":
    generate_mock_csv("mock_telephony_2024_2025.csv")
    print("File generated successfully.")
