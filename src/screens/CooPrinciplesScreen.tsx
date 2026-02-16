import { useState } from "react";
import { useAppActions } from "../state/appState";

interface Principle {
  number: number;
  title: string;
  description: string;
  redFlag: string;
  spotlight: string;
}

const PRINCIPLES: { group: string; items: Principle[] }[] = [
  {
    group: "The Machine \u2014 Operational Excellence",
    items: [
      {
        number: 1,
        title: "Own the operating rhythm",
        description:
          "The cadence of the business \u2014 weekly syncs, monthly reviews, quarterly planning \u2014 is your product. If the rhythm breaks, execution drifts. Design it, protect it, evolve it.",
        redFlag:
          "People don't know what meeting matters most this week.",
        spotlight:
          "Pull up your company's recurring meeting calendar right now. Can you trace a clear line from the weekly team sync to the monthly review to the quarterly plan? If the connections are fuzzy, the rhythm is decorative, not functional. Pick one meeting this week and ask: what decision does this meeting exist to make? If no one can answer, it's a status update pretending to be a meeting."
      },
      {
        number: 2,
        title: "Measure at the process level, not just the outcome level",
        description:
          "The CEO watches conversion rates. You watch the steps between them \u2014 cycle times, handoff quality, queue depth. Outcomes are lagging; process metrics are leading.",
        redFlag:
          "You can quote revenue but not average time-to-close or support response time.",
        spotlight:
          "Pick your most important business outcome \u2014 revenue, retention, whatever it is. Now trace it backward through the three process steps that feed it. What's the cycle time for each step? Where does work sit waiting? If you don't know, you're managing outcomes you can't influence. Block time this week to instrument one of those upstream steps."
      },
      {
        number: 3,
        title: "Standardize before you scale",
        description:
          "Every process that runs on tribal knowledge is a process that breaks at 2x volume. Document the 80%, then scale. Perfection isn't required \u2014 repeatability is.",
        redFlag:
          "Two people doing the same job describe the process completely differently.",
        spotlight:
          "Ask two people who do the same type of work to independently write down their process in five steps. Compare the lists. If they diverge significantly, you have a tribal knowledge problem that will break under load. Don't aim for a perfect SOP \u2014 aim for a shared starting point that covers the common case. The 80% playbook is infinitely better than the 0% playbook."
      },
      {
        number: 4,
        title: "Kill friction relentlessly",
        description:
          "Your job is to remove the things that slow good people down. Every approval layer, every redundant handoff, every \"that's how we've always done it\" is a candidate for elimination.",
        redFlag:
          "People are building workarounds instead of asking for the process to change.",
        spotlight:
          "This week, ask three people on different teams: \"What's one thing that takes way longer than it should?\" Don't defend the current process \u2014 just listen. The workarounds people build are a map of your friction points. Every workaround is someone telling you the system failed them. Pick the most common one and fix the root cause."
      },
      {
        number: 5,
        title: "Build feedback loops, not reporting chains",
        description:
          "Reports go up and die. Feedback loops go around and improve. Design systems where the output of one process informs the input of the next \u2014 automatically, not through a meeting.",
        redFlag:
          "Problems are discovered in a weekly review that the team knew about on Tuesday.",
        spotlight:
          "Think about the last operational problem that surprised you in a meeting. When did the team actually know? If there was a gap of more than 24 hours, you have a reporting chain, not a feedback loop. The fix isn't more meetings \u2014 it's designing the process so that the signal reaches the right person automatically. What alert, dashboard, or Slack notification would have closed that gap?"
      }
    ]
  },
  {
    group: "The People \u2014 Execution Leadership",
    items: [
      {
        number: 6,
        title: "Be the bridge between departments",
        description:
          "Most execution failures are coordination failures. You are the connective tissue. When sales and delivery aren't talking, that's your problem \u2014 not theirs.",
        redFlag:
          "Two department leads are surprised by each other's priorities.",
        spotlight:
          "Pick two teams that depend on each other heavily. Ask each lead independently: \"What do you need from the other team this quarter?\" If the answers don't match, you've found a coordination gap that's costing you execution speed. Your job isn't to mediate \u2014 it's to build the structure (shared goals, joint planning, cross-functional standups) that makes the bridge permanent."
      },
      {
        number: 7,
        title: "Make the implicit explicit",
        description:
          "The CEO has a mental model of how things should work. Your job is to turn that into written playbooks, clear ownership, and defined handoffs. Unspoken expectations are unmet expectations.",
        redFlag:
          "Someone says \"I thought someone else was handling that.\"",
        spotlight:
          "Think about the last dropped ball in your organization. Trace it back: was there a written owner? A defined handoff? A documented process? Almost always, the answer is no \u2014 it was \"understood\" but never explicit. Pick one critical handoff this week and write down: who owns it, what triggers it, what \"done\" looks like, and who gets notified. That's five minutes of work that prevents the next dropped ball."
      },
      {
        number: 8,
        title: "Develop operators, not followers",
        description:
          "Build people who can run their function without you. Coach judgment, not just compliance. The goal is a team of people who make the same decision you would \u2014 and sometimes a better one.",
        redFlag:
          "Your direct reports wait for your input before acting on things within their domain.",
        spotlight:
          "The next time someone brings you a decision that's within their authority, don't answer it. Instead ask: \"What would you do if I weren't here?\" Then let them do that. Your discomfort with letting go is the bottleneck. Every decision you make for them is a rep they didn't get. The compound cost of that is a team that can't function without you."
      },
      {
        number: 9,
        title: "Hold the bar without micromanaging",
        description:
          "Define \"what good looks like\" with enough specificity that you can inspect without hovering. Inspect cadences, not daily work. Trust but verify \u2014 on a rhythm.",
        redFlag:
          "You're reviewing work product instead of reviewing metrics and outcomes.",
        spotlight:
          "For each of your direct reports, can you name the three metrics that tell you their function is healthy \u2014 without looking at their daily output? If you can't, you're either micromanaging or flying blind. Define those metrics, set review cadences, and then genuinely step back from the work product. The goal is to know the score without watching every play."
      },
      {
        number: 10,
        title: "Escalate early, resolve fast",
        description:
          "Don't let problems marinate. Surface issues to the CEO before they're crises, with a proposed solution attached. The COO who surprises the CEO has failed twice \u2014 once at catching it, once at communicating it.",
        redFlag:
          "The CEO hears about an operational issue from a customer or board member first.",
        spotlight:
          "Think about the last time the CEO was surprised by an operational issue. How early did you actually know? The instinct to \"handle it before escalating\" is often the instinct to avoid an uncomfortable conversation. Reframe escalation as a gift: you're giving the CEO the option to weigh in while the problem is still small. Send the message today, not tomorrow."
      },
      {
        number: 11,
        title: "Build bench strength everywhere",
        description:
          "Single points of failure are your enemy. For every critical role, there should be someone who can step in for two weeks without the business noticing. Cross-train aggressively.",
        redFlag:
          "A vacation or sick day causes visible disruption to a function.",
        spotlight:
          "Do a mental fire drill: if each of your direct reports disappeared for two weeks starting tomorrow, who steps in? If the answer for any role is \"nobody\" or \"me,\" that's a single point of failure you're tolerating. Pick the riskiest one and start the cross-training this month. The cost of redundancy is always less than the cost of a surprise absence."
      }
    ]
  },
  {
    group: "The COO \u2014 Self-Management",
    items: [
      {
        number: 12,
        title: "Be the CEO's thinking partner, not their assistant",
        description:
          "You're not there to take orders \u2014 you're there to pressure-test strategy against operational reality. Push back when the vision outpaces the machine's capacity. That tension is the value you add.",
        redFlag:
          "You're executing plans you have reservations about without voicing them.",
        spotlight:
          "When was the last time you told the CEO \"I don't think that's going to work, and here's why\"? If you can't remember, you're functioning as an executor, not a partner. The CEO doesn't need another yes \u2014 they need someone who sees the operational implications they can't. Practice the phrase: \"I can execute that, but here's what it'll cost us operationally.\""
      },
      {
        number: 13,
        title: "Know when to absorb and when to deflect",
        description:
          "Not every fire needs to reach the CEO, but some absolutely must. Your judgment on this boundary is one of your highest-leverage skills. Absorb the noise, escalate the signal.",
        redFlag:
          "The CEO is either overwhelmed with operational detail or blindsided by problems.",
        spotlight:
          "Review the last ten things you escalated to the CEO and the last ten you handled yourself. Were the boundaries right? The test: would the CEO have wanted to know about the ones you absorbed? Would they have wanted to skip the ones you escalated? If you're not sure, ask them directly. Calibrating this boundary is a conversation, not a guess."
      },
      {
        number: 14,
        title: "Stay in the weeds enough to smell problems",
        description:
          "You can't operate from dashboards alone. Regularly touch the actual work \u2014 sit in on a support call, walk through a deployment, read the raw customer feedback. Abstraction is the enemy of operational instinct.",
        redFlag:
          "Your understanding of a process comes entirely from the person who runs it.",
        spotlight:
          "Block one hour this week to observe a frontline process directly \u2014 not a report about it, the actual work. Sit in on a support call, watch a delivery kickoff, read the raw queue. The gap between what you think happens and what actually happens is where operational problems hide. You can't smell problems from the executive floor."
      },
      {
        number: 15,
        title: "Systematize yourself out of every fire",
        description:
          "The first time you fix a fire, you're a hero. The second time, you're a bottleneck. After every operational crisis, ask: what system would have prevented this, or caught it earlier?",
        redFlag:
          "You're solving the same category of problem for the third time.",
        spotlight:
          "Look at your calendar for the last two weeks. How many hours went to firefighting? Now ask: how many of those fires were genuinely novel versus a repeat of a known failure mode? For each repeat, write down the one-line system fix that would prevent it next time. A checklist, an alert, a documented escalation path. Heroics don't scale \u2014 systems do."
      },
      {
        number: 16,
        title: "Protect the CEO's focus ruthlessly",
        description:
          "Your job is to be the shield that lets the CEO work on the highest-leverage things. Every operational question that reaches the CEO is a question your systems didn't answer. Take pride in how little the CEO needs to think about operations.",
        redFlag:
          "The CEO is spending time in operational meetings that don't require their judgment.",
        spotlight:
          "Audit the CEO's calendar for the last week. How many meetings were operational? For each one, ask: did this genuinely require CEO judgment, or did it reach them because no one else had the authority or information to decide? Every operational meeting on the CEO's calendar is a signal that your systems have a gap. Fill it."
      },
      {
        number: 17,
        title: "Own the boring stuff that compounds",
        description:
          "Documentation, onboarding, vendor management, compliance, internal tooling \u2014 none of it is glamorous, all of it compounds. The COO who invests here builds an organization that gets faster every quarter instead of slower.",
        redFlag:
          "New hires take longer to ramp than they did six months ago.",
        spotlight:
          "Measure this: how long does it take a new hire to reach full productivity compared to six months ago? If it's the same or worse, your operational infrastructure is decaying under growth. The boring investments \u2014 better docs, smoother onboarding, cleaner tooling \u2014 are the ones that make the entire organization compound. Pick one this quarter and make it meaningfully better."
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function CooPrinciplesScreen(): JSX.Element {
  const actions = useAppActions();
  const [spotlightIndex, setSpotlightIndex] = useState(() =>
    Math.floor(Math.random() * ALL_PRINCIPLES.length)
  );
  const spotlight = ALL_PRINCIPLES[spotlightIndex];
  const [discussInput, setDiscussInput] = useState("");

  function handleDiscussSubmit(): void {
    const text = discussInput.trim();
    if (!text) return;

    const context = [
      `I'm reflecting on COO Principle #${spotlight.number}: "${spotlight.title}"`,
      "",
      `> ${spotlight.description}`,
      "",
      `> Red flag: ${spotlight.redFlag}`,
      "",
      `> ${spotlight.spotlight}`,
      "",
      `---`,
      "",
      text
    ].join("\n");

    actions.setPendingChatContext({ systemPrompt: "", initialMessage: context });
    actions.selectScreen("chat");
    setDiscussInput("");
  }

  return (
    <section className="screen ceo-principles-screen">
      <div className="screen-header">
        <h2>COO Operating Principles</h2>
        <p>
          Seventeen principles for execution leadership &mdash; turning strategy
          into repeatable, scalable operations.
        </p>
      </div>

      <div className="spotlight-card">
        <div className="spotlight-label">Today's focus</div>
        <div className="spotlight-number">{spotlight.number}</div>
        <h3 className="spotlight-title">{spotlight.title}</h3>
        <p className="spotlight-description">{spotlight.description}</p>
        <div className="spotlight-narrative">{spotlight.spotlight}</div>
        <p className="spotlight-redflag">Red flag: {spotlight.redFlag}</p>

        <div className="spotlight-discuss">
          <input
            className="spotlight-discuss-input"
            type="text"
            placeholder="What's on your mind about this principle?"
            value={discussInput}
            onChange={(e) => setDiscussInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.repeat) {
                e.preventDefault();
                handleDiscussSubmit();
              }
            }}
          />
        </div>
      </div>

      {PRINCIPLES.map((group) => (
        <div className="card" key={group.group}>
          <h3>{group.group}</h3>
          {group.items.map((p) => (
            <div
              className={`principle-item${p.number === spotlight.number ? " principle-active" : ""}`}
              key={p.number}
              onClick={() => setSpotlightIndex(ALL_PRINCIPLES.indexOf(p))}
            >
              <span className="principle-number">{p.number}</span>
              <div>
                <strong>{p.title}</strong>
                <p>{p.description}</p>
                <p className="red-flag">Red flag: {p.redFlag}</p>
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
