import csv
from datetime import datetime, timedelta
import random

def get_multipliers(dt):
    # Day-of-week: Monday highest, weekends ~50% of weekday
    dow = dt.weekday()
    if dow == 0: # Monday
        dow_mult = 1.2
    elif dow < 5: # Tue-Fri
        dow_mult = 1.0
    else: # Sat-Sun
        dow_mult = 0.5
    
    # Monthly seasonality: Jan–Mar baseline, Apr–Aug +10%, Sep–Dec +15% to +30%
    month = dt.month
    if 1 <= month <= 3:
        month_mult = 1.0
    elif 4 <= month <= 8:
        month_mult = 1.1
    elif 9 <= month <= 10:
        month_mult = 1.15
    else: # 11-12
        month_mult = 1.3
        
    return dow_mult * month_mult

def get_voice_base_offer(hour):
    # Intraday pattern: low (12AM–6AM), ramp (7–10AM), peak (10AM–4PM), decline after 6PM
    if 0 <= hour < 6:
        return random.randint(2, 8)
    elif 6 <= hour < 7:
        return random.randint(8, 15)
    elif 7 <= hour < 10:
        return random.randint(15, 30)
    elif 10 <= hour < 16:
        return random.randint(30, 60)
    elif 16 <= hour < 18:
        return random.randint(20, 40)
    else: # 18-24
        return random.randint(10, 20)

def generate_mock_csv(filename):
    start_date = datetime(2024, 1, 1, 0, 0)
    end_date = datetime(2025, 12, 31, 23, 30)
    
    # Original headers + channel and concurrency
    headers = [
        "Interval Start", "Interval End", "Interval Complete", "Filters", 
        "Media Type", "Queue Id", "Queue Name", "Offer", "Answer", 
        "Answer %", "Abandon", "Abandon %", "ASA", "Service Level %", 
        "Service Level Target %", "Avg Wait", "Avg Handle", "Avg Talk", 
        "Avg Hold", "Avg ACW", "Hold", "Transfer", "Short Abandon",
        "channel", "concurrency"
    ]

    queue_id = "b14113c6-caf4-491c-815e-1b89bb25c6b2; 61249553-e73c-4731-a085-f44dc6817d69"
    queue_name = "Vodafone DA; 1223"

    with open(filename, mode='w', newline='') as file:
        writer = csv.writer(file, quoting=csv.QUOTE_ALL)
        writer.writerow(headers)
        
        curr = start_date
        while curr <= end_date:
            interval_end = curr + timedelta(minutes=30)
            
            hour = curr.hour
            mult = get_multipliers(curr)
            
            # --- VOICE ---
            random_factor_voice = random.uniform(0.85, 1.15)
            voice_offer = int(get_voice_base_offer(hour) * mult * random_factor_voice)
            voice_offer = max(1, voice_offer)
            
            voice_abandon = random.randint(0, int(voice_offer * 0.1))
            voice_answer = voice_offer - voice_abandon
            voice_asa = random.uniform(1000, 15000) # 1-15s in ms
            voice_talk = random.uniform(180000, 400000) # 3-6 mins
            voice_acw = random.uniform(30000, 90000)
            voice_handle = voice_talk + voice_acw
            
            # --- EMAIL (Smoother distribution) ---
            # Using base volume instead of randomized voice_offer to keep it smoother
            email_base = get_voice_base_offer(hour) * mult
            email_offer = int(email_base * random.uniform(0.05, 0.15))
            email_abandon = int(email_offer * random.uniform(0, 0.02))
            email_answer = email_offer - email_abandon
            # ASA = 7200 to 14400 seconds (2–4 hours)
            email_asa = random.uniform(7200 * 1000, 14400 * 1000)
            # AHT = 600 to 1200 seconds
            email_handle = random.uniform(600 * 1000, 1200 * 1000)
            email_talk = email_handle * 0.9
            email_acw = email_handle * 0.1
            
            # --- CHAT ---
            # Volume = 20% to 40% of voice
            chat_offer = int(voice_offer * random.uniform(0.20, 0.40))
            chat_abandon = int(chat_offer * random.uniform(0.05, 0.15))
            chat_answer = chat_offer - chat_abandon
            # ASA = 20 to 60 seconds
            chat_asa = random.uniform(20 * 1000, 60 * 1000)
            # AHT = 300 to 600 seconds, effective_aht = AHT / 2
            chat_raw_aht = random.uniform(300 * 1000, 600 * 1000)
            chat_handle = chat_raw_aht / 2 
            chat_talk = chat_handle * 0.8
            chat_acw = chat_handle * 0.2

            channels_data = [
                {
                    "name": "voice", "offer": voice_offer, "answer": voice_answer, "asa": voice_asa,
                    "handle": voice_handle, "talk": voice_talk, "acw": voice_acw, "abandon": voice_abandon,
                    "concurrency": ""
                },
                {
                    "name": "email", "offer": email_offer, "answer": email_answer, "asa": email_asa,
                    "handle": email_handle, "talk": email_talk, "acw": email_acw, "abandon": email_abandon,
                    "concurrency": ""
                },
                {
                    "name": "chat", "offer": chat_offer, "answer": chat_answer, "asa": chat_asa,
                    "handle": chat_handle, "talk": chat_talk, "acw": chat_acw, "abandon": chat_abandon,
                    "concurrency": 2
                }
            ]

            for ch in channels_data:
                offer = ch["offer"]
                if offer > 0:
                    answer = ch["answer"]
                    abandon = ch["abandon"]
                    answer_pct = answer / offer
                    abandon_pct = abandon / offer
                    asa = ch["asa"]
                    handle = ch["handle"]
                    talk = ch["talk"]
                    acw = ch["acw"]
                    
                    if ch["name"] == "voice":
                        sl = 1.0 if asa < 20000 else 0.8
                    elif ch["name"] == "chat":
                        sl = 1.0 if asa < 30000 else 0.8
                    else: 
                        sl = 1.0 if asa < 8 * 3600 * 1000 else 0.8 

                    row = [
                        curr.strftime("%m/%d/%y %I:%M %p"),
                        interval_end.strftime("%m/%d/%y %I:%M %p"),
                        "TRUE", "", ch["name"], queue_id, queue_name,
                        offer, answer, round(answer_pct, 4), 
                        abandon if abandon > 0 else "", 
                        round(abandon_pct, 4) if abandon > 0 else "",
                        round(asa, 2), round(sl, 2), "0.8",
                        round(asa, 2), round(handle, 2), round(talk, 2),
                        "", round(acw, 2), "", "", "",
                        ch["name"], ch["concurrency"]
                    ]
                else:
                    row = [
                        curr.strftime("%m/%d/%y %I:%M %p"),
                        interval_end.strftime("%m/%d/%y %I:%M %p"),
                        "TRUE", "", ch["name"], queue_id, queue_name,
                        "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
                        ch["name"], ch["concurrency"]
                    ]
                writer.writerow(row)
            
            curr += timedelta(minutes=30)

if __name__ == "__main__":
    generate_mock_csv("mock_telephony_2024_2025.csv")
    print("Multi-channel file generated successfully.")
