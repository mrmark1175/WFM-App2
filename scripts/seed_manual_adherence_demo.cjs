try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); } catch {}

const bcrypt = require('bcryptjs');
const { pool } = require('../server/db.cjs');

const PASSWORD = process.env.DEMO_USER_PASSWORD || 'Password123!';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function at(date, time) {
  return `${date}T${time}:00`;
}

async function upsertUser(client, orgId, email, fullName, role, hash) {
  const result = await client.query(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, is_active, must_change_password)
     VALUES ($1,$2,$3,$4,$5,true,false)
     ON CONFLICT (organization_id, email) DO UPDATE SET
       password_hash=EXCLUDED.password_hash,
       full_name=EXCLUDED.full_name,
       role=EXCLUDED.role,
       is_active=true,
       must_change_password=false,
       updated_at=NOW()
     RETURNING id`,
    [orgId, email, hash, fullName, role]
  );
  return result.rows[0].id;
}

async function seed() {
  const date = todayStr();
  const hash = await bcrypt.hash(PASSWORD, 12);
  const client = await pool.connect();
  try {
    await client.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent'`);
    await client.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'rta'`);
    await client.query('BEGIN');

    const orgRes = await client.query(`
      INSERT INTO organizations (name, slug, is_active)
      VALUES ('Exordium Demo BPO', 'exordium-demo-bpo', true)
      ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, is_active=true, updated_at=NOW()
      RETURNING id
    `);
    const orgId = orgRes.rows[0].id;

    const lobRes = await client.query(`
      INSERT INTO lobs (organization_id, lob_name)
      VALUES ($1, 'Manual Adherence Demo')
      ON CONFLICT (organization_id, lob_name) DO UPDATE SET lob_name=EXCLUDED.lob_name
      RETURNING id
    `, [orgId]);
    const lobId = lobRes.rows[0].id;

    await client.query(`
      INSERT INTO manual_adherence_settings (organization_id, lob_id, grace_period_minutes, manual_mode_enabled)
      VALUES ($1,$2,5,true)
      ON CONFLICT (organization_id, lob_id) DO UPDATE SET grace_period_minutes=5, manual_mode_enabled=true, updated_at=NOW()
    `, [orgId, lobId]);

    const rtaId = await upsertUser(client, orgId, 'demo.rta@exordium.test', 'Demo RTA', 'rta', hash);
    await upsertUser(client, orgId, 'demo.supervisor@exordium.test', 'Demo Supervisor', 'supervisor', hash);
    await upsertUser(client, orgId, 'demo.admin@exordium.test', 'Demo Admin', 'client_admin', hash);

    const scenarios = [
      ['A001', 'Ava On Time', 'on_time'],
      ['A002', 'Ben Late Login', 'late_login'],
      ['A003', 'Cara Early Break', 'early_break'],
      ['A004', 'Deo Overbreak', 'overbreak'],
      ['A005', 'Eli Late Lunch', 'late_lunch'],
      ['A006', 'Fia Forgot Lunch Out', 'missing_lunch_out'],
      ['A007', 'Gio Early Logout', 'early_logout'],
      ['A008', 'Hana Offline', 'offline'],
      ['A009', 'Ira Monitor', 'monitor'],
      ['A010', 'Jae Monitor', 'monitor'],
    ];

    for (const [employeeId] of scenarios) {
      const agentRes = await client.query(
        'SELECT id, user_id FROM scheduling_agents WHERE organization_id=$1 AND employee_id=$2',
        [orgId, employeeId]
      );
      for (const row of agentRes.rows) {
        await client.query('DELETE FROM agent_status_punches WHERE organization_id=$1 AND agent_id=$2', [orgId, row.id]);
        await client.query('DELETE FROM schedule_assignments WHERE organization_id=$1 AND agent_id=$2 AND work_date=$3', [orgId, row.id, date]);
      }
    }

    for (const [employeeId, fullName, scenario] of scenarios) {
      const [firstName, ...lastParts] = fullName.split(' ');
      const lastName = lastParts.join(' ');
      const email = `${employeeId.toLowerCase()}@exordium.test`;
      const userId = await upsertUser(client, orgId, email, fullName, 'agent', hash);
      const existingAgent = await client.query(
        'SELECT id FROM scheduling_agents WHERE organization_id=$1 AND employee_id=$2 ORDER BY id LIMIT 1',
        [orgId, employeeId]
      );
      let agentId = existingAgent.rows[0]?.id;
      if (agentId) {
        const found = await client.query(
          `UPDATE scheduling_agents SET first_name=$3, last_name=$4, full_name=$5, email=$6,
             lob_assignments=$7, team_name='Team Atlas', team_leader_name='Demo Supervisor', user_id=$8, status='active', updated_at=NOW()
           WHERE organization_id=$1 AND employee_id=$2 RETURNING id`,
          [orgId, employeeId, firstName, lastName, fullName, email, [lobId], userId]
        );
        agentId = found.rows[0].id;
      } else {
        const agent = await client.query(
          `INSERT INTO scheduling_agents
            (organization_id, employee_id, first_name, last_name, full_name, email, contract_type,
             skill_voice, skill_chat, skill_email, lob_assignments, accommodation_flags, availability,
             status, shift_length_hours, team_name, team_leader_name, user_id)
           VALUES ($1,$2,$3,$4,$5,$6,'full_time',true,false,false,$7,'{}','{}','active',9,'Team Atlas','Demo Supervisor',$8)
           RETURNING id`,
          [orgId, employeeId, firstName, lastName, fullName, email, [lobId], userId]
        );
        agentId = agent.rows[0].id;
      }

      const assignment = await client.query(
        `INSERT INTO schedule_assignments
          (organization_id, lob_id, agent_id, work_date, start_time, end_time, is_overnight, channel, status, notes)
         VALUES ($1,$2,$3,$4,'09:00','18:00',false,'voice','published',$5)
         RETURNING id`,
        [orgId, lobId, agentId, date, `Manual adherence demo: ${scenario}`]
      );
      const assignmentId = assignment.rows[0].id;
      const break1 = await client.query(`INSERT INTO shift_activities (assignment_id, activity_type, start_time, end_time, is_paid, notes) VALUES ($1,'break','11:00','11:15',true,'First Break') RETURNING id`, [assignmentId]);
      const lunch = await client.query(`INSERT INTO shift_activities (assignment_id, activity_type, start_time, end_time, is_paid, notes) VALUES ($1,'meal','13:00','14:00',false,'Lunch') RETURNING id`, [assignmentId]);
      const break2 = await client.query(`INSERT INTO shift_activities (assignment_id, activity_type, start_time, end_time, is_paid, notes) VALUES ($1,'break','16:00','16:15',true,'Second Break') RETURNING id`, [assignmentId]);

      const punches = [];
      const add = (activity, action, time, shiftActivityId = null, note = null) => punches.push([activity, action, at(date, time), shiftActivityId, note]);
      if (scenario === 'late_login') {
        add('login', 'login', '09:12');
      } else {
        add('login', 'login', '08:58');
      }
      if (scenario === 'early_break') {
        add('break', 'in', '10:45', break1.rows[0].id);
        add('break', 'out', '11:00', break1.rows[0].id);
      } else if (scenario === 'overbreak') {
        add('break', 'in', '11:00', break1.rows[0].id);
        add('break', 'out', '11:28', break1.rows[0].id);
      } else if (scenario !== 'late_login') {
        add('break', 'in', '11:00', break1.rows[0].id);
        add('break', 'out', '11:14', break1.rows[0].id);
      }
      if (scenario === 'late_lunch') {
        add('meal', 'in', '13:12', lunch.rows[0].id);
        add('meal', 'out', '14:00', lunch.rows[0].id);
      } else if (scenario === 'missing_lunch_out') {
        add('meal', 'in', '13:00', lunch.rows[0].id);
      } else {
        add('meal', 'in', '13:00', lunch.rows[0].id);
        add('meal', 'out', '13:59', lunch.rows[0].id);
      }
      if (scenario === 'offline') {
        add('offline_work', 'status_change', '15:00', null, 'Approved offline case work');
      } else if (scenario !== 'missing_lunch_out') {
        add('break', 'in', '16:00', break2.rows[0].id);
        add('break', 'out', '16:15', break2.rows[0].id);
      }
      if (scenario === 'early_logout') {
        add('logout', 'logout', '17:40');
      } else if (!['missing_lunch_out', 'offline'].includes(scenario)) {
        add('logout', 'logout', '18:00');
      }

      for (const [activity, action, punchedAt, shiftActivityId, note] of punches) {
        await client.query(
          `INSERT INTO agent_status_punches
            (organization_id, lob_id, agent_id, assignment_id, shift_activity_id, activity_type, punch_action, punched_at, timezone, notes, source, created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UTC',$9,'manual_agent_punch',$10)`,
          [orgId, lobId, agentId, assignmentId, shiftActivityId, activity, action, punchedAt, note, userId]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`[manual-adherence-demo] Seeded org=${orgId}, lob=${lobId}, date=${date}`);
    console.log(`[manual-adherence-demo] Password for demo users: ${PASSWORD}`);
    console.log(`[manual-adherence-demo] RTA login: demo.rta@exordium.test`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[manual-adherence-demo] Error:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
