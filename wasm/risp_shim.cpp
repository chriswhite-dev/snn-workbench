#include <emscripten/emscripten.h>
#include <string>
#include <vector>
#include <unordered_map>
#include <algorithm>
#include <stdexcept>

#include "framework.hpp"
#include "risp.hpp"
#include "nlohmann/json.hpp"

using json = nlohmann::json;
using namespace std;

static risp::Processor *g_proc = nullptr;
static neuro::Network *g_net = nullptr;
static int g_timestep = 0;
static vector<uint32_t> g_sorted_node_ids;
static unordered_map<uint32_t, int> g_node_to_input_id;
static vector<uint32_t> g_last_step_fired;
static vector<uint32_t> g_pending_input_nodes;  // input nodes with queued spikes this step
static string g_last_error;

static void cleanup() {
  delete g_proc; g_proc = nullptr;
  delete g_net;  g_net  = nullptr;
  g_sorted_node_ids.clear();
  g_node_to_input_id.clear();
  g_last_step_fired.clear();
  g_pending_input_nodes.clear();
  g_timestep = 0;
}

// RISP-127 default — used when no proc_params in Associated_Data
static const json RISP_127_DEFAULT = {
  {"discrete",      true},
  {"max_delay",     127},
  {"min_threshold", 1},
  {"max_threshold", 127},
  {"min_weight",    -127},
  {"max_weight",    127},
  {"min_potential", -127}
};

extern "C" {

EMSCRIPTEN_KEEPALIVE
void load_network(const char* json_str) {
  g_last_error.clear();
  try {
    json j = json::parse(json_str);

    cleanup();

    json params = RISP_127_DEFAULT;
    if (j.contains("Associated_Data") &&
        j["Associated_Data"].is_object() &&
        j["Associated_Data"].contains("proc_params")) {
      params = j["Associated_Data"]["proc_params"];
    }

    g_proc = new risp::Processor(params);

    g_net = new neuro::Network();
    g_net->set_properties(g_proc->get_network_properties());

    for (auto& n : j["Nodes"]) {
      uint32_t id = n["id"].get<uint32_t>();
      neuro::Node *node = g_net->add_node(id);
      auto& vals = n["values"];
      for (size_t i = 0; i < vals.size() && i < node->values.size(); i++) {
        node->values[i] = vals[i].get<double>();
      }
    }

    for (auto& e : j["Edges"]) {
      neuro::Edge *edge = g_net->add_edge(
        e["from"].get<uint32_t>(),
        e["to"].get<uint32_t>()
      );
      auto& vals = e["values"];
      for (size_t i = 0; i < vals.size() && i < edge->values.size(); i++) {
        edge->values[i] = vals[i].get<double>();
      }
    }

    size_t input_idx = 0;
    for (auto& inp : j["Inputs"]) {
      uint32_t node_id = inp.get<uint32_t>();
      g_net->add_input(node_id);
      g_node_to_input_id[node_id] = (int) input_idx++;
    }

    for (auto& out : j["Outputs"]) {
      g_net->add_output(out.get<uint32_t>());
    }

    g_proc->load_network(g_net);

    g_net->make_sorted_node_vector();
    for (auto* node : g_net->sorted_node_vector) {
      g_sorted_node_ids.push_back(node->id);
    }

  } catch (const exception& e) {
    g_last_error = e.what();
    cleanup();
  } catch (...) {
    g_last_error = "Unknown exception in load_network";
    cleanup();
  }
}

EMSCRIPTEN_KEEPALIVE
const char* get_error() {
  static string rv;
  rv = g_last_error;
  return rv.c_str();
}

EMSCRIPTEN_KEEPALIVE
void step() {
  if (!g_proc) return;

  // Capture which input nodes had spikes queued, then clear for next step
  vector<uint32_t> inputs_this_step = g_pending_input_nodes;
  g_pending_input_nodes.clear();

  g_proc->run(1);
  g_timestep++;

  g_last_step_fired.clear();

  // Input nodes that had spikes applied count as active this step
  for (auto id : inputs_this_step) {
    g_last_step_fired.push_back(id);
  }

  // Neurons that fired: last_fire == 0 (local time index within this run(1) call)
  // clear_tracking_info() resets last_fire to -1 at the start of each run(), so
  // last_fire == 0 means the neuron fired during this specific step.
  vector<double> last_fires = g_proc->neuron_last_fires();
  for (size_t i = 0; i < g_sorted_node_ids.size(); i++) {
    if (i < last_fires.size() && last_fires[i] == 0) {
      uint32_t nid = g_sorted_node_ids[i];
      if (find(g_last_step_fired.begin(), g_last_step_fired.end(), nid) == g_last_step_fired.end()) {
        g_last_step_fired.push_back(nid);
      }
    }
  }
}

EMSCRIPTEN_KEEPALIVE
void apply_spikes(const char* json_str) {
  if (!g_proc) return;
  try {
    json j = json::parse(json_str);
    for (auto& item : j) {
      uint32_t node_id = item.get<uint32_t>();
      auto it = g_node_to_input_id.find(node_id);
      if (it != g_node_to_input_id.end()) {
        neuro::Spike s(it->second, 0, 1.0);
        g_proc->apply_spike(s, true);
        g_pending_input_nodes.push_back(node_id);
      }
    }
  } catch (const exception&) {}
}

EMSCRIPTEN_KEEPALIVE
void reset() {
  if (!g_proc) return;
  g_proc->clear_activity();
  g_timestep = 0;
  g_last_step_fired.clear();
  g_pending_input_nodes.clear();
}

EMSCRIPTEN_KEEPALIVE
const char* get_state() {
  static string rv;

  if (!g_proc) {
    rv = "{}";
    return rv.c_str();
  }

  json j;
  j["timestep"] = g_timestep;
  j["spikes"] = g_last_step_fired;
  j["potentials"] = json::object();

  vector<double> charges = g_proc->neuron_charges();
  for (size_t i = 0; i < g_sorted_node_ids.size() && i < charges.size(); i++) {
    j["potentials"][to_string(g_sorted_node_ids[i])] = charges[i];
  }

  rv = j.dump();
  return rv.c_str();
}

} // extern "C"
