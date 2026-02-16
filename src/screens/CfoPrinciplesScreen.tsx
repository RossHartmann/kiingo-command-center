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
    group: "The Numbers \u2014 Financial Architecture",
    items: [
      {
        number: 1,
        title: "Cash is oxygen, not a scoreboard",
        description:
          "Revenue is vanity, profit is sanity, cash is reality. You can be profitable on paper and dead in practice. Manage cash position with the same intensity a pilot manages altitude \u2014 because running out means the same thing.",
        redFlag:
          "You report revenue growth without mentioning cash runway or burn rate in the same breath.",
        spotlight:
          "What's your current cash runway in months? Not projected \u2014 actual, based on trailing three-month burn. If you can't answer within ten seconds, your cash visibility is insufficient. Build a rolling 13-week cash flow forecast that updates weekly. It should show you exactly when cash gets tight, not approximately. The companies that run out of cash almost always saw it coming \u2014 they just weren't looking at the right report."
      },
      {
        number: 2,
        title: "Know your unit economics cold",
        description:
          "Customer acquisition cost, lifetime value, gross margin per offering, and payback period \u2014 these are the vital signs of the business. If you can't recite them from memory, you can't steer the business. Every strategic decision should be pressure-tested against unit economics.",
        redFlag:
          "You know aggregate revenue but can't break down profitability by customer segment or offering.",
        spotlight:
          "Calculate your fully-loaded CAC and LTV by customer segment. Not the simplified version \u2014 include all sales and marketing costs, onboarding costs, and ongoing service costs. Now calculate the LTV:CAC ratio for each segment. If any segment is below 3:1, you're either acquiring unprofitable customers or your pricing is wrong. This analysis should update quarterly and drive resource allocation conversations."
      },
      {
        number: 3,
        title: "Build the financial model that tells the truth",
        description:
          "The financial model isn't a sales pitch \u2014 it's a decision-making tool. Build it with honest assumptions, sensitivity analysis, and clear documentation of what you believe and why. A model that only shows the happy path is a liability disguised as a plan.",
        redFlag:
          "Your financial model has one scenario and the assumptions aren't documented.",
        spotlight:
          "Open your financial model right now. Can you identify every assumption and trace it to evidence? Run three scenarios: base case, downside (what if growth slows 30%), and severe downside (what if a major customer churns). Do you still have cash? Do you still hit breakeven? If you've never run the downside, you don't actually understand your financial position \u2014 you understand your hopes."
      },
      {
        number: 4,
        title: "Budget for outcomes, not for departments",
        description:
          "Traditional budgeting allocates money to departments and lets them spend it. Strategic budgeting allocates money to outcomes \u2014 growth, efficiency, risk reduction \u2014 and holds the spending accountable to results. The budget should be a strategy document, not an entitlement program.",
        redFlag:
          "Departments fight over budget increases without connecting the request to measurable outcomes.",
        spotlight:
          "Review your current budget structure. For each major line item, can you name the outcome it's supposed to produce and how you'll measure whether it worked? If a budget item can't be connected to an outcome, it's either overhead (which should be minimized) or an unexamined habit (which should be questioned). The most powerful budget conversations aren't about how much to spend, but about what the spending is supposed to achieve."
      },
      {
        number: 5,
        title: "Price with courage, not with fear",
        description:
          "Most companies underprice because they're afraid of losing deals. But underpricing doesn't just reduce revenue \u2014 it signals low value, attracts price-sensitive customers, and makes it nearly impossible to invest in the product. Price for the value you deliver, raise prices regularly, and track the data to see what actually happens.",
        redFlag:
          "You haven't raised prices in over a year and you can't articulate why.",
        spotlight:
          "When did you last raise prices? What happened to close rates? Most companies that raise prices by 10-20% see minimal churn and significant revenue uplift. If you haven't tested a price increase, you're leaving money on the table out of fear, not data. Design a small experiment: raise prices for new customers in one segment and measure the impact over 90 days. The data will likely surprise you."
      },
      {
        number: 6,
        title: "Make the invisible visible",
        description:
          "Hidden costs kill companies slowly. Embedded contractor spend, technical debt interest, customer acquisition costs buried in sales salaries, and infrastructure creep \u2014 your job is to surface every cost so the leadership team can make informed trade-offs.",
        redFlag:
          "A significant cost category isn't tracked or reported on its own line.",
        spotlight:
          "Audit your P&L for hidden costs. Are contractor costs buried in department budgets? Is cloud infrastructure growing faster than revenue? Are you tracking the cost of customer churn (lost LTV)? For each hidden cost you find, create a dedicated line item and a quarterly trend. You can't manage what you can't see, and the costs that hide are usually the ones that grow fastest."
      }
    ]
  },
  {
    group: "The Partnership \u2014 Strategic Finance",
    items: [
      {
        number: 7,
        title: "Be the CEO's financial conscience, not their accountant",
        description:
          "The CEO doesn't need you to track expenses \u2014 software does that. They need you to say 'we can't afford that,' 'here's what that decision costs us,' and 'here's the financial implication of that strategy.' You are the voice of financial discipline in every strategic conversation.",
        redFlag:
          "You present financial reports but don't challenge strategic assumptions with financial data.",
        spotlight:
          "In your last three conversations with the CEO about strategy, how many times did you introduce a financial constraint or trade-off they hadn't considered? If the answer is zero, you're reporting, not partnering. Before your next strategy discussion, prepare one insight: 'If we do X, the financial implication is Y, and here's the data.' That's the contribution that makes you indispensable."
      },
      {
        number: 8,
        title: "Fund experiments, not just operations",
        description:
          "A budget that only funds known activities is a budget that guarantees stagnation. Allocate a deliberate percentage \u2014 even 5-10% \u2014 for experiments with uncertain outcomes. Define success criteria upfront, run the experiment, and kill or scale based on data.",
        redFlag:
          "Every dollar in the budget is allocated to an existing activity and there's no room for new bets.",
        spotlight:
          "What percentage of your budget is allocated to new initiatives versus maintaining existing operations? If it's under 10%, the company is operationally focused but strategically static. Carve out an experimentation budget with clear rules: maximum investment per experiment, defined success criteria, and a timeline for the kill-or-scale decision. The discipline of structured experimentation is cheaper than the cost of missing the next growth lever."
      },
      {
        number: 9,
        title: "Tell the story in the numbers",
        description:
          "Financial reports should tell a story, not just display data. What changed? Why? What does it mean for the future? The CFO who delivers a spreadsheet is delegating interpretation to people less equipped to do it. Deliver the narrative, then back it with the data.",
        redFlag:
          "Your financial presentations require extensive verbal explanation to make sense.",
        spotlight:
          "Take your most recent financial report and remove all verbal context. Can a smart non-finance executive understand the story from the report alone? If not, restructure it: lead with the three most important insights, follow with the data that supports them, and end with the implications. The best financial reports are read, not presented. If yours requires a meeting to be understood, the report isn't doing its job."
      },
      {
        number: 10,
        title: "Manage risk explicitly, not implicitly",
        description:
          "Every business carries financial risk \u2014 concentration risk, market risk, operational risk, liquidity risk. Your job is to identify, quantify, and communicate these risks so the leadership team can make conscious decisions about which risks to accept and which to mitigate.",
        redFlag:
          "Your top customer represents more than 20% of revenue and no one has discussed the concentration risk.",
        spotlight:
          "List your top five financial risks right now. For each one, can you estimate the probability and the financial impact? If any risk is unquantified, that's your first priority \u2014 because an unquantified risk is an unmanaged risk. Present these to the leadership team with your recommended mitigation for each. The conversation about which risks to accept is one of the highest-leverage discussions a leadership team can have."
      },
      {
        number: 11,
        title: "Automate the routine, invest in the judgment",
        description:
          "Bookkeeping, reconciliation, and standard reporting should be as automated as possible. Every hour your finance team spends on routine tasks is an hour not spent on analysis, forecasting, and strategic decision support. Build the machine so the humans can think.",
        redFlag:
          "Your finance team spends more time producing reports than analyzing them.",
        spotlight:
          "Time your finance team's work for a week. What percentage is data entry, reconciliation, and report generation versus analysis, forecasting, and strategic support? If routine work exceeds 50%, you have an automation deficit. Identify the three most time-consuming routine tasks and evaluate automation options. The ROI isn't just time savings \u2014 it's the strategic capacity you unlock when your team stops being data processors and starts being decision advisors."
      }
    ]
  },
  {
    group: "The CFO \u2014 Self-Management",
    items: [
      {
        number: 12,
        title: "Learn the business, not just the books",
        description:
          "The CFO who only understands accounting is a controller with a bigger title. You need to understand the product, the market, the sales cycle, and the operational model deeply enough to challenge assumptions and contribute strategically. Finance is the lens, not the whole picture.",
        redFlag:
          "You can explain the financial statements but not the business model that drives them.",
        spotlight:
          "When was the last time you sat in on a sales call, attended a product demo, or talked to a customer directly? If you can't remember, your financial perspective is disconnected from the business reality. Block time this month for two activities: shadow a sales rep and attend a product review. The insights you gain will make your financial analysis dramatically more useful."
      },
      {
        number: 13,
        title: "Deliver bad news early and with a plan",
        description:
          "The CFO who waits to deliver bad news until it's undeniable has failed their most basic responsibility. Surface financial concerns early, with data, context, and a proposed response. The leadership team can't course-correct on information they don't have.",
        redFlag:
          "A financial miss is first discussed at the end of the quarter instead of midway through.",
        spotlight:
          "Think about the last financial surprise \u2014 a missed target, an unexpected cost, a cash shortfall. When did you first see the signal? When did you communicate it? If there was a gap, that gap is your credibility risk. Build early warning triggers: if pipeline drops below threshold by week four, escalate. If burn rate exceeds plan by 10% in any month, flag it immediately. The cost of a false alarm is nothing compared to the cost of a late alarm."
      },
      {
        number: 14,
        title: "Build financial literacy across the company",
        description:
          "Finance shouldn't be a black box that only the finance team understands. When department leaders understand gross margin, contribution margin, and cash flow, they make better decisions every day without needing to ask you. Invest in financial literacy as an organizational capability.",
        redFlag:
          "Department leaders can't explain how their spending affects the company's financial health.",
        spotlight:
          "Pick three non-finance leaders and ask them: 'How does your team's work affect gross margin?' If they can't answer clearly, they're making resource decisions without understanding the financial impact. Build a simple financial literacy session \u2014 not accounting 101, but the five numbers that matter for this business and how each department influences them. When everyone speaks basic finance, your job gets easier and the company gets smarter."
      },
      {
        number: 15,
        title: "Guard the balance sheet like a fiduciary",
        description:
          "You are the steward of the company's financial health. That means protecting cash reserves, managing debt responsibly, ensuring compliance, and occasionally saying no to spending that feels strategic but isn't financially sound. Popularity isn't part of the job description.",
        redFlag:
          "You approve spending you have reservations about because you don't want to be the blocker.",
        spotlight:
          "Review the last five spending requests you approved. For each one, did you genuinely believe it was the best use of the capital, or did you approve it because saying no felt harder than saying yes? The CFO who can't say no isn't a guardian \u2014 they're a rubber stamp. Practice the phrase: 'I understand the strategic intent. Here's why the financial case doesn't support it yet, and here's what would need to be true for me to approve it.'"
      },
      {
        number: 16,
        title: "Plan for the downside before it arrives",
        description:
          "Contingency planning isn't pessimism \u2014 it's professionalism. Know exactly what you'd cut if revenue dropped 20%, what your minimum viable burn rate looks like, and how long your reserves last under stress. The time to build the lifeboat is before the storm.",
        redFlag:
          "You don't have a documented cost-reduction plan that could be activated within two weeks.",
        spotlight:
          "Write a one-page contingency plan right now: if revenue dropped 25% next month, what would you cut, in what order, and what would the timeline be? If you can't write it in 30 minutes, you haven't thought about it enough. The plan should have three tiers: first cuts (non-essential), second cuts (painful but survivable), and third cuts (existential). Having this plan doesn't mean you'll need it \u2014 it means you won't panic if you do."
      },
      {
        number: 17,
        title: "Compound the trust, not just the returns",
        description:
          "Your most valuable asset isn't the financial model \u2014 it's the trust of the CEO, the board, and the leadership team. That trust compounds with every honest forecast, every early warning, and every tough conversation you initiate. Protect it above all else.",
        redFlag:
          "You shade the numbers to make the story more comfortable.",
        spotlight:
          "Ask yourself honestly: is there any number in your current reporting that you've framed more favorably than the raw data supports? Any metric where you chose the most flattering comparison period? Any risk you've downplayed? If yes, fix it today. One shaded number can undo years of trust. The CFO's credibility is binary \u2014 you either have it or you don't. There's no partial trust in financial leadership."
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function CfoPrinciplesScreen(): JSX.Element {
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
      `I'm reflecting on CFO Principle #${spotlight.number}: "${spotlight.title}"`,
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
        <h2>CFO Operating Principles</h2>
        <p>
          Seventeen principles for financial leadership &mdash; stewarding capital,
          partnering on strategy, and building financial clarity across the organization.
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
