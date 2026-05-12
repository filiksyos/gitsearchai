import { DetectiveLogo } from "@/components/DetectiveLogo";
import { GitHubSearch } from "@/components/GitHubSearch";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-start mb-12">
          <div className="flex-1 flex justify-start" />
          <div className="text-center flex-1">
            <div className="flex justify-center mb-6">
              <DetectiveLogo className="w-32 h-32" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              AI GitHub Search
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Search GitHub repositories using natural language.
            </p>
          </div>
          <div className="flex-1" />
        </div>

        <GitHubSearch />
      </div>
    </div>
  );
}
