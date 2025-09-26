import path from "path";
import fs from "fs-extra";
import log from "electron-log";
import { runShellCommand } from "./runShellCommand";
import { addTerminalOutput } from "../handlers/terminal_handlers";
import { getDyadAppPath } from "../../paths/paths";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";

const logger = log.scope("development_orchestrator");

/**
 * Development phases for autonomous app development
 */
export enum DevelopmentPhase {
  INITIALIZING = "initializing",
  FRONTEND_SETUP = "frontend_setup",
  FRONTEND_DEVELOPMENT = "frontend_development",
  FRONTEND_REVIEW = "frontend_review",
  FRONTEND_IMPROVEMENT = "frontend_improvement",
  BACKEND_SETUP = "backend_setup",
  BACKEND_DEVELOPMENT = "backend_development",
  BACKEND_REVIEW = "backend_review",
  BACKEND_IMPROVEMENT = "backend_improvement",
  INTEGRATION = "integration",
  TESTING = "testing",
  COMPLETION = "completion",
  HUMAN_INTERVENTION = "human_intervention",
  ERROR = "error"
}

/**
 * Development state interface
 */
export interface DevelopmentState {
  appId: number;
  phase: DevelopmentPhase;
  isActive: boolean;
  lastActivity: Date;
  frontendComplete: boolean;
  backendComplete: boolean;
  humanInterventionRequired: boolean;
  humanInterventionMessage?: string;
  errors: string[];
  progress: number; // 0-100
  metadata: {
    frontendFramework?: string;
    backendFramework?: string;
    requirements?: string[];
    improvements?: string[];
    [key: string]: any;
  };
}

/**
 * Autonomous Development Orchestrator
 * Manages the autonomous development flow from frontend to backend
 */
export class DevelopmentOrchestrator {
  private static instance: DevelopmentOrchestrator;
  private activeDevelopments: Map<number, DevelopmentState> = new Map();

  private constructor() {
    // No IpcClient dependency needed - this runs in main process
  }

  public static getInstance(): DevelopmentOrchestrator {
    if (!DevelopmentOrchestrator.instance) {
      DevelopmentOrchestrator.instance = new DevelopmentOrchestrator();
    }
    return DevelopmentOrchestrator.instance;
  }

  /**
   * Start autonomous development for a new app
   */
  public async startAutonomousDevelopment(
    appId: number,
    frontendFramework: string = "react",
    backendFramework?: string,
    requirements?: string[]
  ): Promise<void> {
    logger.info(`Starting autonomous development for app ${appId}`);

    const state: DevelopmentState = {
      appId,
      phase: DevelopmentPhase.INITIALIZING,
      isActive: true,
      lastActivity: new Date(),
      frontendComplete: false,
      backendComplete: false,
      humanInterventionRequired: false,
      errors: [],
      progress: 0,
      metadata: {
        frontendFramework,
        backendFramework,
        requirements: requirements || []
      }
    };

    this.activeDevelopments.set(appId, state);

    try {
      // Start the development flow
      await this.executeDevelopmentPhase(state);
    } catch (error) {
      logger.error(`Error in autonomous development for app ${appId}:`, error);
      await this.handleDevelopmentError(state, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Continue development after human intervention
   */
  public async continueAfterHumanIntervention(appId: number): Promise<void> {
    const state = this.activeDevelopments.get(appId);
    if (!state) {
      throw new Error(`No active development found for app ${appId}`);
    }

    state.humanInterventionRequired = false;
    state.humanInterventionMessage = undefined;
    state.lastActivity = new Date();

    await this.executeDevelopmentPhase(state);
  }

  /**
   * Execute the current development phase
   */
  private async executeDevelopmentPhase(state: DevelopmentState): Promise<void> {
    switch (state.phase) {
      case DevelopmentPhase.INITIALIZING:
        await this.handleInitializingPhase(state);
        break;

      case DevelopmentPhase.FRONTEND_SETUP:
        await this.handleFrontendSetupPhase(state);
        break;

      case DevelopmentPhase.FRONTEND_DEVELOPMENT:
        await this.handleFrontendDevelopmentPhase(state);
        break;

      case DevelopmentPhase.FRONTEND_REVIEW:
        await this.handleFrontendReviewPhase(state);
        break;

      case DevelopmentPhase.FRONTEND_IMPROVEMENT:
        await this.handleFrontendImprovementPhase(state);
        break;

      case DevelopmentPhase.BACKEND_SETUP:
        await this.handleBackendSetupPhase(state);
        break;

      case DevelopmentPhase.BACKEND_DEVELOPMENT:
        await this.handleBackendDevelopmentPhase(state);
        break;

      case DevelopmentPhase.BACKEND_REVIEW:
        await this.handleBackendReviewPhase(state);
        break;

      case DevelopmentPhase.BACKEND_IMPROVEMENT:
        await this.handleBackendImprovementPhase(state);
        break;

      case DevelopmentPhase.INTEGRATION:
        await this.handleIntegrationPhase(state);
        break;

      case DevelopmentPhase.TESTING:
        await this.handleTestingPhase(state);
        break;

      case DevelopmentPhase.COMPLETION:
        await this.handleCompletionPhase(state);
        break;

      default:
        logger.warn(`Unknown development phase: ${state.phase}`);
        break;
    }
  }

  /**
   * Handle the initializing phase
   */
  private async handleInitializingPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Initializing development for app ${state.appId}`);
    state.progress = 5;
    state.phase = DevelopmentPhase.FRONTEND_SETUP;
    state.lastActivity = new Date();

    await this.executeDevelopmentPhase(state);
  }

  /**
   * Handle frontend setup phase
   */
  private async handleFrontendSetupPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Setting up frontend for app ${state.appId}`);
    state.progress = 10;

    try {
      // Frontend setup is already handled by createFromTemplate
      // We just need to transition to development
      state.phase = DevelopmentPhase.FRONTEND_DEVELOPMENT;
      state.progress = 15;
      state.lastActivity = new Date();

      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Frontend setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle frontend development phase
   */
  private async handleFrontendDevelopmentPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Starting frontend development for app ${state.appId}`);
    state.progress = 20;

    try {
      // Get app details from database
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, state.appId),
      });

      if (!app) {
        throw new Error(`App ${state.appId} not found`);
      }

      const appPath = getDyadAppPath(app.path);
      const frontendPath = path.join(appPath, "frontend");

      // Start frontend development server
      await this.startFrontendServer(state.appId, frontendPath);

      // Generate initial frontend code based on requirements
      await this.generateInitialFrontend(state, frontendPath);

      // Wait for initial development to stabilize
      await new Promise(resolve => setTimeout(resolve, 5000));

      state.phase = DevelopmentPhase.FRONTEND_REVIEW;
      state.progress = 40;
      state.lastActivity = new Date();

      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Frontend development failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle frontend review phase
   */
  private async handleFrontendReviewPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Reviewing frontend for app ${state.appId}`);
    state.progress = 45;

    try {
      // Trigger LLM review of frontend code
      const improvements = await this.reviewCodeQuality(state, "frontend");

      if (improvements.length > 0) {
        state.metadata.improvements = improvements;
        state.phase = DevelopmentPhase.FRONTEND_IMPROVEMENT;
        state.progress = 50;
      } else {
        // Frontend is good, move to backend
        state.frontendComplete = true;
        state.phase = state.metadata.backendFramework ? DevelopmentPhase.BACKEND_SETUP : DevelopmentPhase.COMPLETION;
        state.progress = state.metadata.backendFramework ? 55 : 100;
      }

      state.lastActivity = new Date();
      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Frontend review failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle frontend improvement phase
   */
  private async handleFrontendImprovementPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Improving frontend for app ${state.appId}`);
    state.progress = 55;

    try {
      // Apply LLM-suggested improvements
      await this.applyCodeImprovements(state, "frontend");

      // Re-review after improvements
      state.phase = DevelopmentPhase.FRONTEND_REVIEW;
      state.progress = 60;
      state.lastActivity = new Date();

      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Frontend improvement failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle backend setup phase
   */
  private async handleBackendSetupPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Setting up backend for app ${state.appId}`);
    state.progress = 65;

    try {
      // Backend setup is already handled by createFromTemplate
      // We just need to transition to development
      state.phase = DevelopmentPhase.BACKEND_DEVELOPMENT;
      state.progress = 70;
      state.lastActivity = new Date();

      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Backend setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle backend development phase
   */
  private async handleBackendDevelopmentPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Starting backend development for app ${state.appId}`);
    state.progress = 75;

    try {
      // Get app details from database
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, state.appId),
      });

      if (!app) {
        throw new Error(`App ${state.appId} not found`);
      }

      const appPath = getDyadAppPath(app.path);
      const backendPath = path.join(appPath, "backend");

      // Start backend development server
      await this.startBackendServer(state.appId, backendPath, state.metadata.backendFramework);

      // Generate initial backend code based on requirements
      await this.generateInitialBackend(state, backendPath);

      // Wait for initial development to stabilize
      await new Promise(resolve => setTimeout(resolve, 5000));

      state.phase = DevelopmentPhase.BACKEND_REVIEW;
      state.progress = 85;
      state.lastActivity = new Date();

      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Backend development failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle backend review phase
   */
  private async handleBackendReviewPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Reviewing backend for app ${state.appId}`);
    state.progress = 88;

    try {
      // Trigger LLM review of backend code
      const improvements = await this.reviewCodeQuality(state, "backend");

      if (improvements.length > 0) {
        state.metadata.improvements = improvements;
        state.phase = DevelopmentPhase.BACKEND_IMPROVEMENT;
        state.progress = 90;
      } else {
        // Backend is good, move to integration
        state.backendComplete = true;
        state.phase = DevelopmentPhase.INTEGRATION;
        state.progress = 92;
      }

      state.lastActivity = new Date();
      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Backend review failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle backend improvement phase
   */
  private async handleBackendImprovementPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Improving backend for app ${state.appId}`);
    state.progress = 93;

    try {
      // Apply LLM-suggested improvements
      await this.applyCodeImprovements(state, "backend");

      // Re-review after improvements
      state.phase = DevelopmentPhase.BACKEND_REVIEW;
      state.progress = 95;
      state.lastActivity = new Date();

      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Backend improvement failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle integration phase
   */
  private async handleIntegrationPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Integrating frontend and backend for app ${state.appId}`);
    state.progress = 96;

    try {
      // Test frontend-backend integration
      await this.testIntegration(state);

      state.phase = DevelopmentPhase.TESTING;
      state.progress = 98;
      state.lastActivity = new Date();

      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Integration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle testing phase
   */
  private async handleTestingPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Running tests for app ${state.appId}`);
    state.progress = 99;

    try {
      // Run automated tests
      await this.runTests(state);

      state.phase = DevelopmentPhase.COMPLETION;
      state.progress = 100;
      state.lastActivity = new Date();

      await this.executeDevelopmentPhase(state);
    } catch (error) {
      await this.handleDevelopmentError(state, `Testing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle completion phase
   */
  private async handleCompletionPhase(state: DevelopmentState): Promise<void> {
    logger.info(`Completing development for app ${state.appId}`);
    state.progress = 100;
    state.isActive = false;

    // Clean up development state
    this.activeDevelopments.delete(state.appId);

    // Send completion notification
    await this.sendNotification(state.appId, "Development completed successfully!", "success");
  }

  /**
   * Handle development errors
   */
  private async handleDevelopmentError(state: DevelopmentState, error: string): Promise<void> {
    logger.error(`Development error for app ${state.appId}: ${error}`);
    state.errors.push(error);
    state.phase = DevelopmentPhase.ERROR;
    state.isActive = false;

    // Send error notification and request human intervention
    state.humanInterventionRequired = true;
    state.humanInterventionMessage = `Development encountered an error: ${error}. Please review and continue.`;

    await this.sendNotification(state.appId, state.humanInterventionMessage, "error");
  }

  /**
   * Start frontend development server
   */
  private async startFrontendServer(appId: number, frontendPath: string): Promise<void> {
    try {
      logger.info(`Frontend server setup for app ${appId} - will be started when user runs the app`);
      // The frontend server will be started when the user clicks "Run App"
      // For now, we just log that we're ready to start development
    } catch (error) {
      logger.error(`Failed to set up frontend server: ${error}`);
      throw error;
    }
  }

  /**
   * Start backend development server
   */
  private async startBackendServer(appId: number, backendPath: string, framework?: string): Promise<void> {
    try {
      logger.info(`Starting backend server for app ${appId} with framework ${framework}`);
      // Backend server starting is handled by the setupBackendFramework function
      // We just need to ensure it's running
    } catch (error) {
      logger.error(`Failed to start backend server: ${error}`);
      throw error;
    }
  }

  /**
   * Generate initial frontend code
   */
  private async generateInitialFrontend(state: DevelopmentState, frontendPath: string): Promise<void> {
    const requirements = state.metadata.requirements || [];

    // Send initial development prompt to LLM
    const prompt = `
You are developing a React frontend application. The user requirements are:
${requirements.join('\n')}

Please generate a well-structured React application with the following structure:
- Clean, modern UI using Tailwind CSS and shadcn/ui components
- Proper TypeScript types
- Responsive design
- Good user experience

Focus on creating a solid foundation that can be built upon.

Current AI_RULES.md contains development guidelines. Follow them strictly.
`;

    // This would trigger an LLM call - for now, we'll just log
    logger.info(`Generating initial frontend for app ${state.appId} with requirements: ${requirements.join(', ')}`);

    // In a real implementation, this would call the LLM API
    // For now, we'll simulate completion
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Generate initial backend code
   */
  private async generateInitialBackend(state: DevelopmentState, backendPath: string): Promise<void> {
    const requirements = state.metadata.requirements || [];
    const framework = state.metadata.backendFramework;

    // Send initial development prompt to LLM
    const prompt = `
You are developing a ${framework} backend application. The user requirements are:
${requirements.join('\n')}

Please generate a well-structured backend application with:
- Proper API endpoints
- Database models (if needed)
- Authentication (if required)
- Error handling
- Clean, maintainable code

IMPORTANT: Use proper dyad-write tags to create files. Always include the "path" attribute.
For backend files, use paths like "backend/main.py" or "backend/server.js" etc.

**DO NOT attempt to run backend servers manually.** The system automatically handles server startup when users click the "Run App" button. Focus ONLY on creating code files. The system will automatically detect the framework and start the appropriate server.

Current AI_RULES.md contains development guidelines. Follow them strictly.
`;

    logger.info(`Generating initial backend for app ${state.appId} with framework ${framework} and requirements: ${requirements.join(', ')}`);

    // In a real implementation, this would call the LLM API
    // For now, we'll simulate completion
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Review code quality using LLM
   */
  private async reviewCodeQuality(state: DevelopmentState, component: "frontend" | "backend"): Promise<string[]> {
    logger.info(`Reviewing ${component} code quality for app ${state.appId}`);

    // In a real implementation, this would analyze the code and call LLM for review
    // For now, we'll return mock improvements
    const mockImprovements = [
      "Add proper error boundaries",
      "Implement loading states",
      "Add input validation",
      "Improve accessibility"
    ];

    // Simulate LLM review time
    await new Promise(resolve => setTimeout(resolve, 1000));

    return Math.random() > 0.7 ? mockImprovements : []; // 30% chance of finding improvements
  }

  /**
   * Apply code improvements suggested by LLM
   */
  private async applyCodeImprovements(state: DevelopmentState, component: "frontend" | "backend"): Promise<void> {
    const improvements = state.metadata.improvements || [];

    logger.info(`Applying ${improvements.length} improvements to ${component} for app ${state.appId}`);

    // In a real implementation, this would apply the LLM suggestions
    // For now, we'll simulate the work
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  /**
   * Test frontend-backend integration
   */
  private async testIntegration(state: DevelopmentState): Promise<void> {
    logger.info(`Testing integration for app ${state.appId}`);

    // In a real implementation, this would run integration tests
    // For now, we'll simulate testing
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Run automated tests
   */
  private async runTests(state: DevelopmentState): Promise<void> {
    logger.info(`Running tests for app ${state.appId}`);

    // In a real implementation, this would run test suites
    // For now, we'll simulate testing
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Send notification to user
   */
  private async sendNotification(appId: number, message: string, type: "info" | "success" | "error" = "info"): Promise<void> {
    // This would send a notification to the UI
    logger.info(`Notification for app ${appId}: ${message}`);

    // In a real implementation, this would use IPC to send notifications to the UI
  }

  /**
   * Get development state for an app
   */
  public getDevelopmentState(appId: number): DevelopmentState | undefined {
    return this.activeDevelopments.get(appId);
  }

  /**
   * Get all active developments
   */
  public getAllActiveDevelopments(): DevelopmentState[] {
    return Array.from(this.activeDevelopments.values());
  }

  /**
   * Stop development for an app
   */
  public stopDevelopment(appId: number): void {
    const state = this.activeDevelopments.get(appId);
    if (state) {
      state.isActive = false;
      state.phase = DevelopmentPhase.ERROR;
      logger.info(`Stopped development for app ${appId}`);
    }
  }

  /**
   * Check if human intervention is required
   */
  public requiresHumanIntervention(appId: number): boolean {
    const state = this.activeDevelopments.get(appId);
    return state?.humanInterventionRequired || false;
  }

  /**
   * Get human intervention message
   */
  public getHumanInterventionMessage(appId: number): string | undefined {
    const state = this.activeDevelopments.get(appId);
    return state?.humanInterventionMessage;
  }
}

// Export singleton instance
export const developmentOrchestrator = DevelopmentOrchestrator.getInstance();