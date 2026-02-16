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
    group: "The Organization \u2014 Talent Architecture",
    items: [
      {
        number: 1,
        title: "Hire for where you're going, not where you've been",
        description:
          "The team that got you here won't necessarily get you there. Every hire should be evaluated against the company you're building, not the company you are today. This doesn't mean replacing people \u2014 it means developing them for the future or filling gaps they can't fill.",
        redFlag:
          "Your job descriptions are copied from the last time you hired for the role, without reflecting how the company has evolved.",
        spotlight:
          "Pull your three most recent job descriptions. Do they describe the role as it exists today, or as it needs to exist in 18 months? If they're backward-looking, you're hiring to maintain, not to grow. For each open role, ask: 'What will this person need to do in 18 months that they won't need to do in the first month?' Build the job description around the future state, then assess candidates for their trajectory, not just their current skill set."
      },
      {
        number: 2,
        title: "Culture is what you tolerate, not what you declare",
        description:
          "Your values wall means nothing if the behaviors you tolerate contradict it. Culture is defined by the worst behavior you accept from your highest performer. If someone delivers results while undermining the culture, and you look the other way, you've declared your actual values.",
        redFlag:
          "A high performer is known for toxic behavior and no one addresses it because they hit their numbers.",
        spotlight:
          "Name your company's top three cultural values. Now think of the last person who violated one of them. What happened? If the answer is 'nothing, because they're a top performer,' you've identified the gap between your declared culture and your actual culture. The fix isn't a policy \u2014 it's a conversation with that person, followed by consequences if the behavior doesn't change. Your team is watching how you handle this more closely than you think."
      },
      {
        number: 3,
        title: "Build a hiring system, not a hiring habit",
        description:
          "Inconsistent interviewing produces inconsistent hires. Define clear competencies, structured interviews, calibrated scorecards, and debrief protocols. When hiring is systematic, you can diagnose what's working and what isn't. When it's ad hoc, every hire is a gamble.",
        redFlag:
          "Different interviewers evaluate the same candidate on completely different criteria.",
        spotlight:
          "Audit your last five interview debriefs. Did every interviewer assess the same competencies, or did each person evaluate whatever they felt like? If the latter, your interviews are gathering random impressions, not structured data. Build a scorecard with five competencies that predict success in your environment, assign each interviewer specific competencies to assess, and require evidence-based ratings. Structured interviews are 2x more predictive than unstructured ones."
      },
      {
        number: 4,
        title: "Onboard like you mean it",
        description:
          "The first 90 days shape how someone performs for years. A new hire who flounders in onboarding isn't a bad hire \u2014 they're a victim of a bad system. Design onboarding with the same rigor as your product: clear milestones, defined checkpoints, and a feedback loop.",
        redFlag:
          "New hires consistently say they felt lost during their first month.",
        spotlight:
          "Ask your last three hires: 'What was the most confusing part of your first two weeks?' Their answers are your onboarding roadmap. Then ask their managers: 'At what point did this person become genuinely productive?' If the answer is more than 60 days, your onboarding is too slow. Map the critical milestones: by day 7 they should know X, by day 30 they should have done Y, by day 60 they should own Z. Then measure every new hire against those milestones."
      },
      {
        number: 5,
        title: "Make performance management continuous, not annual",
        description:
          "The annual review is a relic. Feedback that arrives once a year is too late to change behavior and too infrequent to build trust. Build a cadence of regular check-ins, real-time feedback, and quarterly development conversations. Performance management is a system, not an event.",
        redFlag:
          "The only formal feedback employees receive is during the annual review cycle.",
        spotlight:
          "How often do your managers have substantive development conversations with their direct reports \u2014 not status updates, but genuine discussions about growth, challenges, and career trajectory? If the answer is 'annually' or 'when there's a problem,' your performance system is reactive. Implement a simple quarterly check-in: what went well, what could improve, what support do you need? Twenty minutes per quarter per person compounds into dramatically better performance and retention."
      },
      {
        number: 6,
        title: "Pay fairly, transparently, and strategically",
        description:
          "Compensation isn't just about market rates \u2014 it's about internal equity, strategic signaling, and trust. When employees discover pay inequities, and they always do, the damage to trust is severe and lasting. Build a compensation philosophy, communicate it clearly, and audit it regularly.",
        redFlag:
          "Two people in the same role with similar performance have significantly different compensation and no one can explain why.",
        spotlight:
          "Run a compensation equity analysis this quarter. Compare pay across same-role, same-level employees. Segment by gender, tenure, and hiring date. If you find unexplained gaps greater than 5%, you have an equity problem that's eroding trust whether you see it or not. The fix isn't just adjustments \u2014 it's building a transparent framework that prevents gaps from recurring. Employees who trust the compensation system bring their full energy to work."
      }
    ]
  },
  {
    group: "The People \u2014 Development and Engagement",
    items: [
      {
        number: 7,
        title: "Develop managers before you develop employees",
        description:
          "Employees don't leave companies \u2014 they leave managers. The quality of your management layer determines engagement, retention, and performance more than any other factor. Invest disproportionately in making your managers excellent, because their impact multiplies across every person they lead.",
        redFlag:
          "Your best individual contributors are promoted to management with no management training.",
        spotlight:
          "Survey your managers on their confidence in three areas: having difficult conversations, developing their team's skills, and making performance decisions. The areas where confidence is lowest are your training priorities. Don't build a generic leadership program \u2014 build targeted skill development for the specific gaps your managers face. A manager who can have one difficult conversation well this quarter creates more value than any training module."
      },
      {
        number: 8,
        title: "Make career paths visible and real",
        description:
          "If employees can't see where they're going, they'll go somewhere else. Career paths should be documented, discussed regularly, and visibly modeled by people who've walked them. Ambiguity about advancement is one of the top drivers of voluntary turnover.",
        redFlag:
          "Employees say they don't know what they need to do to get promoted.",
        spotlight:
          "Ask ten employees at random: 'What do you need to accomplish to reach the next level?' If fewer than seven can answer clearly, your career paths are invisible. For each role, document three to five concrete criteria for advancement. Share them widely. Then review them with your managers to ensure they're actually being used in development conversations. A career path that exists only in a document no one reads is the same as no career path at all."
      },
      {
        number: 9,
        title: "Measure engagement to manage it, not to celebrate it",
        description:
          "Engagement surveys are diagnostic tools, not report cards. A high score that doesn't lead to action is vanity. A low score that triggers genuine improvement is strategy. The value of measuring engagement is entirely determined by what you do with the data.",
        redFlag:
          "You run annual engagement surveys but action items from the last survey are incomplete or forgotten.",
        spotlight:
          "Open your most recent engagement survey results. For each area with below-average scores, is there an action plan with an owner and a deadline? If not, the survey was a waste of everyone's time \u2014 and worse, it created expectations you didn't meet. Pick the single lowest-scoring area, build one concrete action plan, and communicate it to the company with a deadline. Then follow through. Completing one action builds more trust than publishing a beautiful survey report."
      },
      {
        number: 10,
        title: "Build diversity as a capability, not a checkbox",
        description:
          "Diverse teams make better decisions, see more risks, and build more inclusive products. But diversity without inclusion is a revolving door. Your job is to build systems that attract diverse talent, create environments where they thrive, and ensure their voices shape decisions. This is a business capability, not a compliance requirement.",
        redFlag:
          "Your diversity metrics improve at the hiring stage but decline at the promotion and retention stages.",
        spotlight:
          "Look at your talent pipeline at four stages: applicant pool, hiring, promotion, and retention. If diversity decreases at any stage, that's where your system is filtering. Applicant pool gaps suggest sourcing problems. Hiring gaps suggest bias in evaluation. Promotion gaps suggest visibility or sponsorship problems. Retention gaps suggest culture or belonging problems. Each one needs a different intervention. Measure all four stages quarterly."
      },
      {
        number: 11,
        title: "Exit interviews are gold \u2014 mine them",
        description:
          "The people who leave voluntarily know things about your organization that the people who stay won't tell you. Every exit interview should be analyzed for patterns, not just filed. When three departing employees cite the same issue, that's a signal you can't afford to ignore.",
        redFlag:
          "Exit interviews are conducted but the insights aren't aggregated or acted upon.",
        spotlight:
          "Pull your exit interview data from the last twelve months. Categorize every reason for leaving into themes. What are the top three? Are any of them the same themes from the year before? If the same issues are driving turnover year after year, your organization is paying a recurring tax for a known problem. Present the top three themes to the leadership team with a recommendation for each. The cost of inaction is measured in replacement costs: typically 50-200% of salary per departing employee."
      }
    ]
  },
  {
    group: "The CHRO \u2014 Self-Management",
    items: [
      {
        number: 12,
        title: "Be the CEO's strategic partner on people, not their HR administrator",
        description:
          "The CHRO who only processes paperwork and handles compliance is a utility function, not a strategic partner. Your value is connecting people strategy to business strategy \u2014 workforce planning, organizational design, succession planning, and culture architecture. If you're not shaping how the company is built, you're maintaining how it was.",
        redFlag:
          "Your conversations with the CEO are about policy compliance and headcount, not about organizational capability and talent strategy.",
        spotlight:
          "In your last three conversations with the CEO, how many were about strategic workforce topics (org design, succession, culture) versus operational HR topics (benefits, compliance, individual issues)? If operational topics dominate, you're positioned as an administrator. Before your next CEO meeting, bring one strategic insight: a succession risk, an organizational friction point, or a talent market trend that affects strategy. That's the contribution that earns your seat."
      },
      {
        number: 13,
        title: "Know the business deeply enough to challenge it",
        description:
          "You can't build the right team if you don't understand the business they're building. Know the product, the market, the competitive landscape, and the financial model. The CHRO who understands the business makes people decisions that accelerate strategy. The one who doesn't makes decisions that feel good but don't move the needle.",
        redFlag:
          "You can't explain the company's business model and competitive advantage as clearly as you can explain the benefits package.",
        spotlight:
          "Could you credibly present the company's strategy and competitive position to a new hire \u2014 not the HR version, the real version? If not, spend time with the CEO, the CRO, and the CPO until you can. Attend pipeline reviews, product demos, and customer calls. The best people decisions are business decisions with a people lens. You can't apply that lens if you only understand the people side."
      },
      {
        number: 14,
        title: "Use data to lead, not just to report",
        description:
          "People analytics should drive decisions, not just describe outcomes. Turnover rates, engagement scores, time-to-fill, and promotion velocity are inputs to strategy, not just metrics to present. Build the capability to predict and prevent problems, not just to document them after the fact.",
        redFlag:
          "Your people data tells you what happened last quarter but can't predict what will happen next quarter.",
        spotlight:
          "What's your voluntary turnover prediction for next quarter? If you can't answer, your analytics are descriptive, not predictive. Start simple: identify the three strongest predictors of voluntary departure in your data (common ones: time since last promotion, manager satisfaction score, and compensation percentile). Build a watch list of employees who hit two or more risk factors. Proactive intervention based on data is 10x more effective than reactive scrambling after the resignation."
      },
      {
        number: 15,
        title: "Have the courage to protect people from the business, and the business from people",
        description:
          "Some days you protect employees from unreasonable demands. Other days you protect the company from employees who aren't meeting the bar. Both require courage. The CHRO who only advocates in one direction becomes either a pushover or a hammer. Balance is the job.",
        redFlag:
          "You're perceived as either 'always on management's side' or 'always blocking management decisions.'",
        spotlight:
          "Think about your last five significant people decisions. Were they balanced between protecting employee interests and protecting business interests? If they skew in one direction, you may be building a reputation that undermines your effectiveness. The hardest version of this: sometimes protecting the business means making a tough call on someone you like. Sometimes protecting employees means telling the CEO something uncomfortable. Both are part of the job."
      },
      {
        number: 16,
        title: "Build the organization that outlasts any individual",
        description:
          "The ultimate test of a people strategy isn't whether the team is strong today \u2014 it's whether the organization can absorb departures, grow through transitions, and emerge stronger from change. Succession planning, knowledge management, and cultural resilience are the infrastructure of organizational durability.",
        redFlag:
          "The departure of any single person would create a significant operational crisis.",
        spotlight:
          "Do a succession audit: for every critical role, is there someone who could step in within 30 days? If not, you have a fragility problem that's invisible until it's urgent. For each gap, start one of three actions: develop an internal successor, cross-train a backup, or document the role's critical knowledge. The goal isn't to make people replaceable \u2014 it's to make the organization resilient. Those are different things."
      },
      {
        number: 17,
        title: "Remember that every policy affects a real person",
        description:
          "It's easy to optimize for efficiency and consistency in HR systems. But every policy, every process, and every decision affects individual humans with individual circumstances. The CHRO who loses sight of the individual while managing the system becomes the very thing employees dread about HR.",
        redFlag:
          "Employees describe HR as 'bureaucratic' or 'doesn't listen' and the feedback is dismissed as inevitable.",
        spotlight:
          "Pick one policy you enforce regularly. Now think of the last time someone asked for an exception. How was it handled? Did the process treat them as a case number or as a person? The best HR organizations have clear policies and thoughtful exception processes. The policy creates consistency; the exception process creates trust. If your team doesn't feel empowered to exercise judgment on exceptions, you've built a system that values compliance over people."
      }
    ]
  }
];

const ALL_PRINCIPLES = PRINCIPLES.flatMap((g) => g.items);

export function ChroPrinciplesScreen(): JSX.Element {
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
      `I'm reflecting on CHRO Principle #${spotlight.number}: "${spotlight.title}"`,
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
        <h2>CHRO Operating Principles</h2>
        <p>
          Seventeen principles for people leadership &mdash; building culture,
          developing talent, and designing organizations that thrive.
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
