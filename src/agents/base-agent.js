// Base Agent Class
// Provides foundation for all agents

const { createOpenCodeAgent } = require('../../opencode-agent');

class BaseAgent {
  constructor(model, tools, config) {
    this.model = model;
    this.tools = tools;
    this.config = config;
    this.name = config.name;
    this.description = config.description;
    this.systemPrompt = config.systemPrompt;
    this.agent = null;
  }

  async initialize() {
    // Initialize the OpenCode agent
    this.agent = await createOpenCodeAgent({
      model: this.model,
      systemPrompt: this.systemPrompt,
      tools: this.tools,
      name: this.name,
      description: this.description,
      options: {
        maxSteps: 5,
        temperature: 0.1
      }
    });
    return this.agent;
  }

  async run(userMessage, options = {}) {
    if (!this.agent) {
      await this.initialize();
    }

    const result = await this.agent.run({
      message: userMessage,
      options
    });

    return result;
  }

  async process(recapData, slidesData) {
    // Process recap against slides using the agent's capabilities
    throw new Error('Subclass must implement process method');
  }
}

module.exports = BaseAgent;