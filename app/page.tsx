// Deliberately boring landing page: says what this is, nothing more.
// No data, no endpoints enumerated, no client JS.

export default function Home() {
  return (
    <main style={{ maxWidth: "36rem", padding: "2rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: "0.5rem" }}>Madtrolden 🧌</h1>
      <p style={{ opacity: 0.85 }}>
        En privat MCP-server til familie og venner: planlægger billig mad ud fra ugens danske
        tilbudsaviser — budgetloft, madplan, indkøbsliste og nærmeste butikker, direkte i din egen
        Claude.
      </p>
      <p style={{ opacity: 0.6, fontSize: "0.9rem" }}>
        Adgang kræver en personlig nøgle. Har du fået en, så følg{" "}
        <a
          href="https://github.com/DonBarbaG/madtrolden-mcp/blob/main/ONBOARDING.md"
          style={{ color: "#9ecfb8" }}
        >
          opsætningsguiden
        </a>
        .
      </p>
      <p style={{ opacity: 0.4, fontSize: "0.8rem" }}>
        Bygget på{" "}
        <a href="https://github.com/olgasafonova/tilbudstrolden-mcp" style={{ color: "inherit" }}>
          tilbudstrolden-mcp
        </a>{" "}
        (MIT) · data fra eTilbudsavis/Tjek, DAWA og DTU Fødevareinstituttet.
      </p>
    </main>
  );
}
