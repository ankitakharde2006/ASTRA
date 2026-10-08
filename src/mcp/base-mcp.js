// Base MCP Server Class
// Provides foundation for all MCP servers

class BaseMCP {
  constructor(name, config) {
    this.name = name;
    this.description = config.description;
    this.version = config.version;
    this.capabilities = config.capabilities || [];
    this.tools = this.initializeTools();
  }

  initializeTools() {
    return {
      execute: this.executeTool.bind(this)
    };
  }

  async executeTool(toolName, params) {
    if (!this.tools[toolName]) {
      throw new Error(`Tool ${toolName} not found in MCP server ${this.name}`);
    }
    return await this.tools[toolName](params);
  }

  async registerTool(name, handler) {
    this.tools[name] = handler;
  }
}

module.exports = BaseMCP;