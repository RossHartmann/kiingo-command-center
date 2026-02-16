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
    group: "The Number \u2014 Revenue Architecture",
    items: [
      {
        number: 1,
        title: "Own the number, not just the forecast",
        description:
          "The forecast is a prediction. The number is a commitment. You don't get to miss it and blame the model \u2014 you own every input that feeds it: pipeline coverage, conversion rates, deal velocity, and average deal size. If one breaks, you fix it before the quarter ends, not after.",
        redFlag:
          "You can quote your forecast but can't name which specific deals will close it.",
        spotlight:
          "Open your forecast right now. For each deal in the commit column, can you name the next concrete step, the timeline, and the risk? If any deal is there because it 'should' close rather than because you have evidence it will, move it to best case. The gap between your commit and your reality is the gap between your credibility and your hope. Close that gap weekly, not quarterly."
      },
      {
        number: 2,
        title: "Build a pipeline machine, not a pipeline prayer",
        description:
          "Consistent revenue comes from consistent pipeline. If your team is scrambling for pipeline at the start of every quarter, the system is broken. Build predictable pipeline generation into the operating rhythm \u2014 sourcing, prospecting, partnerships, and marketing-generated opportunities should all have targets and cadences.",
        redFlag:
          "Pipeline coverage drops below 3x at any point in the quarter.",
        spotlight:
          "Calculate your pipeline coverage ratio right now: total qualified pipeline divided by quota. If it's below 3x, you're relying on deals you haven't found yet. Trace backward: how much pipeline did each source generate last quarter? Which sources are trending down? The fix isn't more activity \u2014 it's understanding which pipeline sources are reliable and which are aspirational, then doubling down on the reliable ones."
      },
      {
        number: 3,
        title: "Inspect the process, not just the outcome",
        description:
          "Win rates, cycle times, and stage conversion rates tell you where the machine is breaking before the revenue number tells you. By the time you miss the number, it's too late. Leading indicators are your early warning system \u2014 build the discipline to watch them weekly.",
        redFlag:
          "You review pipeline in dollars but not in conversion rates or stage velocity.",
        spotlight:
          "Pull your stage-by-stage conversion rates for the last two quarters. Where is the biggest drop-off? That's where your process is weakest. Now ask: is it a skill problem (reps can't execute that stage), a qualification problem (wrong deals entering that stage), or a process problem (the stage itself is poorly defined)? Each diagnosis demands a different fix. Treating them all the same is why pipeline reviews feel repetitive but nothing improves."
      },
      {
        number: 4,
        title: "Define your sales process or your reps will invent their own",
        description:
          "A sales process isn't a suggestion \u2014 it's the codified version of how your best deals close. Exit criteria for each stage, required activities, and documented next steps. Without it, every rep runs their own playbook and you can't diagnose or scale anything.",
        redFlag:
          "Two reps describe the same deal stage completely differently.",
        spotlight:
          "Ask three reps independently: 'What has to be true for a deal to be in Stage 3?' If you get three different answers, your sales process is tribal knowledge. Write down the exit criteria for each stage in five bullet points. Share it. Train to it. Inspect against it. The goal isn't rigidity \u2014 it's a shared language that lets you diagnose problems at scale instead of deal by deal."
      },
      {
        number: 5,
        title: "Align every function around the revenue target",
        description:
          "Revenue isn't a sales problem \u2014 it's a company problem. Marketing generates pipeline, product enables differentiation, customer success drives expansion, and sales closes. If any function is misaligned with the revenue target, you'll feel it in the number. Your job is to be the connective tissue.",
        redFlag:
          "Marketing, sales, and CS each have targets that don't mathematically connect to the revenue goal.",
        spotlight:
          "Map the revenue target backward: how much comes from new business, how much from expansion, how much from renewals? For each bucket, which function owns it? Do their targets add up to your number? If marketing's pipeline target at historical conversion rates doesn't cover the new business goal, the math is broken \u2014 and you'll discover it in Q3 when it's too late. Fix the math now."
      },
      {
        number: 6,
        title: "Price for value, not for comfort",
        description:
          "Discounting is the tax on unclear value. If your team discounts to close, either the value proposition isn't sharp enough or the reps aren't trained to sell on value. Every unnecessary discount compounds into margin erosion that kills the business slowly.",
        redFlag:
          "Average discount exceeds 15% and no one can explain why specific deals required it.",
        spotlight:
          "Pull your discount data for last quarter. What was the average discount? More importantly, what was the distribution \u2014 are a few large discounts skewing it, or is discounting systemic? For the top five largest discounts, trace each one: was it competitive pressure, poor qualification, or a rep who wanted to close faster? Each cause demands a different intervention. Blanket 'stop discounting' mandates don't work \u2014 targeted coaching does."
      }
    ]
  },
  {
    group: "The Team \u2014 Performance Culture",
    items: [
      {
        number: 7,
        title: "Hire athletes, not resumes",
        description:
          "Past quota attainment matters less than coachability, grit, and intellectual curiosity. The rep who crushed it at a brand-name company with inbound leads may flounder in your environment. Hire for the capacity to learn and compete, then build the system that makes them successful.",
        redFlag:
          "New hires with impressive resumes consistently underperform after six months.",
        spotlight:
          "Look at your top three performers. What traits do they share that weren't on their resume? Now look at your last three hires who didn't work out. What did their resumes promise that didn't translate? The gap between those two lists is your hiring filter error. Update your interview scorecard to weight the traits that actually predict success in your environment, not the ones that look good on paper."
      },
      {
        number: 8,
        title: "Coach to the middle, not just the top and bottom",
        description:
          "Your top reps will perform regardless. Your bottom reps may need to be managed out. But the middle 60% is where coaching has the highest ROI \u2014 moving a B player to a B+ across ten reps adds more revenue than making one A player an A+.",
        redFlag:
          "Your 1:1s focus on your best and worst performers while the middle gets status updates.",
        spotlight:
          "Rank your team by performance. Identify your middle 60%. When was the last time you did a deep-dive coaching session with each of them \u2014 not a pipeline review, but actual skill development? If you can't remember, your coaching is going where it feels most urgent, not where it has the most leverage. Block time this week for one skill-focused coaching session with a middle performer. Focus on one specific behavior, not general advice."
      },
      {
        number: 9,
        title: "Run a forecast you'd bet your job on",
        description:
          "Forecast accuracy isn't about optimism or conservatism \u2014 it's about rigor. Every deal in the commit column should have verifiable evidence. If you're consistently surprised by the outcome, your inspection process is broken, not your luck.",
        redFlag:
          "Your forecast accuracy is below 80% and you explain it with 'deals slipped.'",
        spotlight:
          "Review your last three quarterly forecasts versus actuals. Where did you miss \u2014 upside or downside? For each miss, was the information available earlier that should have changed the forecast? Almost always, yes. The question isn't whether you can predict the future \u2014 it's whether you're asking the right questions about the present. For every commit deal, require: confirmed decision criteria, identified decision maker, agreed timeline, and a documented next step."
      },
      {
        number: 10,
        title: "Make the comp plan a strategy document, not just a pay structure",
        description:
          "Your compensation plan is the single most powerful tool for driving behavior. If you want reps to sell multi-year deals, comp them more for it. If you want them to prospect, make it part of the variable. The comp plan should be a direct translation of your strategic priorities into financial incentives.",
        redFlag:
          "Your comp plan rewards behaviors that conflict with your stated strategy.",
        spotlight:
          "Write down your top three strategic priorities for the year. Now open your comp plan. Does the comp plan disproportionately reward those three things? If your priority is expansion revenue but the comp plan pays the same rate for new and expansion, you've told reps what matters while paying them to ignore it. The comp plan always wins the argument with the strategy deck."
      },
      {
        number: 11,
        title: "Create a culture of accountability, not fear",
        description:
          "Accountability means everyone knows their number, their activities, and their gaps \u2014 and they own the conversation about what to do about it. Fear means people hide bad news and sandbag forecasts. The difference is whether you treat misses as data or as failures.",
        redFlag:
          "Reps inflate pipeline or delay bad news until it's too late to course-correct.",
        spotlight:
          "In your last team meeting, did anyone voluntarily share a deal they were going to lose or a gap in their pipeline? If not, your culture rewards hiding problems. Start by sharing your own miss or concern openly. 'I'm worried about our pipeline for next quarter \u2014 here's what I see.' When the leader models vulnerability with data, the team follows. Accountability starts with psychological safety, not with consequences."
      }
    ]
  },
  {
    group: "The CRO \u2014 Self-Management",
    items: [
      {
        number: 12,
        title: "Be the bridge between the board and the field",
        description:
          "The board sees revenue as a number. The field sees it as a hundred individual deals. Your job is to translate in both directions \u2014 giving the board confidence in the process while giving the field clarity on what matters. If either side feels disconnected, you've failed the translation.",
        redFlag:
          "The board asks questions your team can't answer, or the team doesn't understand why the board cares.",
        spotlight:
          "After your last board meeting, did you brief your team on the questions the board asked and why they asked them? If not, your team is operating in a vacuum. After your last team meeting, did you update the board on a field-level insight that changed the strategic picture? If not, the board is operating on abstractions. Schedule both translations as recurring habits, not afterthoughts."
      },
      {
        number: 13,
        title: "Spend time with customers, not just reports",
        description:
          "Dashboards show you what happened. Customer conversations show you what's about to happen. Block time every week to be on calls, attend QBRs, and hear directly from the market. The CRO who manages from spreadsheets alone is managing yesterday.",
        redFlag:
          "You haven't been on a customer or prospect call in the last two weeks.",
        spotlight:
          "Block two hours this week: one hour on a prospect call, one hour on a customer call. Don't coach, don't run the call \u2014 just listen. What are you hearing about the market, the competition, the objections that isn't making it into your pipeline reports? The insights that change strategy almost never come from dashboards. They come from listening to the words customers actually use."
      },
      {
        number: 14,
        title: "Kill complexity before it kills velocity",
        description:
          "Every extra approval, every additional tool, every new process step slows down the revenue engine. Your job is to relentlessly simplify \u2014 fewer steps to close, fewer tools to learn, fewer meetings that don't drive deals. Complexity is the silent killer of sales velocity.",
        redFlag:
          "Reps spend more than 30% of their time on non-selling activities.",
        spotlight:
          "Ask your reps: 'How much of your day is spent actually talking to prospects or customers?' If the answer is less than 50%, audit where the time goes. CRM data entry, internal meetings, proposal creation, approval chains \u2014 each one is a tax on revenue. Pick the biggest time sink and cut it in half this quarter. The rep hours you free up translate directly into pipeline and revenue."
      },
      {
        number: 15,
        title: "Plan for next quarter while executing this one",
        description:
          "The CRO who only lives in the current quarter is always behind. Pipeline generation, hiring, territory planning, and strategic initiatives all have lead times. Dedicate at least 20% of your time to next quarter's setup while your team executes this quarter's number.",
        redFlag:
          "Every quarter starts with a pipeline scramble because no one was building ahead.",
        spotlight:
          "Right now, what's your pipeline coverage for next quarter? If you don't know the answer immediately, you're not planning ahead \u2014 you're reacting. Build a simple weekly tracker: next quarter's pipeline, next quarter's hiring needs, next quarter's strategic bets. Review it for 15 minutes every Monday. The compound effect of consistently planning one quarter ahead is the difference between growing and scrambling."
      },
      {
        number: 16,
        title: "Know when to systematize and when to improvise",
        description:
          "Not everything should be a process. Early-stage deals with enterprise buyers need creativity and judgment. High-volume transactional sales need rigid process and automation. Your job is to know which parts of the revenue engine need structure and which need freedom \u2014 and to build accordingly.",
        redFlag:
          "You apply the same management approach to your enterprise team and your SMB team.",
        spotlight:
          "Segment your revenue engine by deal type. For each segment, ask: is this a judgment game or a volume game? Judgment games need coaching, flexibility, and rep empowerment. Volume games need process, automation, and consistency. If you're managing both the same way, you're optimizing one at the expense of the other. The best CROs build different operating systems for different revenue motions."
      },
      {
        number: 17,
        title: "Earn your seat at the strategy table",
        description:
          "The CRO who only talks about pipeline and quota is a VP of Sales with a better title. Your value is connecting revenue reality to company strategy \u2014 market insights, competitive dynamics, pricing strategy, and go-to-market architecture. If you're not shaping strategy, you're executing someone else's.",
        redFlag:
          "You're invited to strategy meetings but only asked about the revenue forecast.",
        spotlight:
          "In your last strategy discussion, did you contribute an insight that changed the direction of the conversation \u2014 something about market positioning, competitive dynamics, or customer behavior that no one else in the room had? If not, you showed up as a reporter, not a strategist. Before your next leadership meeting, prepare one insight from the field that has strategic implications beyond the forecast. That's the contribution that earns your seat."
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function CroPrinciplesScreen(): JSX.Element {
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
      `I'm reflecting on CRO Principle #${spotlight.number}: "${spotlight.title}"`,
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
        <h2>CRO Operating Principles</h2>
        <p>
          Seventeen principles for revenue leadership &mdash; building pipeline,
          driving predictable growth, and earning strategic influence.
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
